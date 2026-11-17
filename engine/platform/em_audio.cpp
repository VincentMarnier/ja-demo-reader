/*
===========================================================================
Emscripten audio output for the demo player.

The engine keeps using its software mixer (snd_mix.cpp); this file only
replaces the DMA/output backend.  Both hosts run the module in a context where
the usual SDL audio device is wrong: the worker has no AudioContext at all, and
the main-thread host should not open a second SDL device.  The PCM is therefore
handed to a small JavaScript bridge (Module.jkaAudio) that owns the Web Audio
playback clock:

  open(rate, frames, channels) -> actual sample rate, 0 when unavailable
  submit(startFrame, pcm, frameCount)
  playFrame() -> absolute frame currently audible
  clear()      -> drop already queued audio (S_ClearSoundBuffer)
  close()
  activate()

The bridge copies the engine's ring buffer; the JS side schedules it on an
AudioContext timeline and returns the audible position, which is what
S_GetSoundtime() needs.  The ring layout is the engine's own:
frame index = s_paintedtime & (frames - 1).
===========================================================================
*/

#include <emscripten.h>
#include <stdlib.h>

#include "client/client.h"
#include "client/snd_local.h"

// How far the engine mixes ahead of playback.  16384 stereo frames is 371 ms
// at 44.1 kHz, comfortably above s_mixahead (0.2 s).
#define JKA_AUDIO_FRAMES 16384

static int			jka_audioChannels;
static int			jka_audioFrames;
static int			jka_audioFrameBytes;
static int			jka_audioFinalized;	// absolute frames already handed to the page
static int			jka_audioPaintStart;	// first frame of the current paint window
static int			jka_audioPaintEnd;	// end of the previous paint, to spot a clear
static qboolean		jka_audioStarted;

static int JKA_AudioPlayFrame( void )
{
	if ( !jka_audioStarted ) {
		return 0;
	}

	return EM_ASM_INT( {
		return ( typeof Module === 'object' && Module.jkaAudio ) ? Module.jkaAudio.playFrame() : 0;
	} );
}

static void JKA_AudioClear( void )
{
	EM_ASM( {
		if ( typeof Module === 'object' && Module.jkaAudio ) {
			Module.jkaAudio.clear();
		}
	} );
}

static void JKA_AudioSubmitRange( int startFrame, int frameCount )
{
	int index = startFrame & ( jka_audioFrames - 1 );
	int first = frameCount;

	if ( index + first > jka_audioFrames ) {
		first = jka_audioFrames - index;
	}

	// Copy inside the snippet: HEAP16 is not exported on Module for this build,
	// and the worker host needs a standalone buffer to transfer anyway.
	EM_ASM( {
		var count = $2 * $3;
		var offset = $0 >> 1;
		var pcm = new Int16Array( count );
		pcm.set( HEAP16.subarray( offset, offset + count ) );
		Module.jkaAudio.submit( $1, pcm.buffer, $2 );
	}, ( int )( size_t )( dma.buffer + ( size_t )index * jka_audioFrameBytes ), startFrame, first, jka_audioChannels );

	if ( frameCount > first ) {
		EM_ASM( {
			var count = $2 * $3;
			var offset = $0 >> 1;
			var pcm = new Int16Array( count );
			pcm.set( HEAP16.subarray( offset, offset + count ) );
			Module.jkaAudio.submit( $1, pcm.buffer, $2 );
		}, ( int )( size_t )dma.buffer, startFrame + first, frameCount - first, jka_audioChannels );
	}
}

qboolean SNDDMA_Init( int sampleFrequencyInKHz )
{
	int requestedRate;
	int rate;

	if ( jka_audioStarted ) {
		return qtrue;
	}

	if ( !EM_ASM_INT( {
		return ( typeof Module === 'object' && Module.jkaAudio ) ? 1 : 0;
	} ) ) {
		Com_Printf( "JKA audio: no Web Audio bridge (sound disabled).\n" );
		return qfalse;
	}

	jka_audioChannels = 2;
	jka_audioFrames = JKA_AUDIO_FRAMES;
	jka_audioFrameBytes = jka_audioChannels * ( int )sizeof( short );

	switch ( sampleFrequencyInKHz ) {
	case 11: requestedRate = 11025; break;
	case 22: requestedRate = 22050; break;
	default: requestedRate = 44100; break;
	}
	rate = EM_ASM_INT( {
		return Module.jkaAudio.open( $0, $1, $2 );
	}, requestedRate, jka_audioFrames, jka_audioChannels );
	if ( rate <= 0 ) {
		Com_Printf( "JKA audio: Web Audio output is not available (sound disabled).\n" );
		return qfalse;
	}

	dma.samplebits = 16;
	dma.channels = jka_audioChannels;
	dma.samples = jka_audioFrames * jka_audioChannels;
	dma.submission_chunk = 1;
	dma.speed = rate;
	dma.buffer = ( byte * )calloc( 1, ( size_t )dma.samples * sizeof( short ) );
	if ( !dma.buffer ) {
		return qfalse;
	}

	jka_audioFinalized = 0;
	jka_audioPaintStart = 0;
	jka_audioPaintEnd = 0;
	jka_audioStarted = qtrue;

	Com_Printf( "JKA audio: Web Audio bridge, %d Hz, %d frames, %d channels\n",
		dma.speed, jka_audioFrames, jka_audioChannels );
	return qtrue;
}

int SNDDMA_GetDMAPos( void )
{
	int frame;

	if ( !jka_audioStarted ) {
		return 0;
	}

	frame = JKA_AudioPlayFrame();
	if ( frame < 0 ) {
		frame = 0;
	}

	// The engine expects interleaved sample units, not frames.
	return ( frame & ( jka_audioFrames - 1 ) ) * jka_audioChannels;
}

void SNDDMA_BeginPainting( void )
{
	// S_PaintChannels() repaints the whole mix-ahead window every frame.  Only
	// the start of this window is final for the previous pass: everything after
	// it may still receive a new sound on a later frame.  Capture it so Submit
	// sends the part that just became final rather than the far end of the
	// window (which delayed every new sound by the mix-ahead depth).
	jka_audioPaintStart = s_paintedtime;
}

void SNDDMA_Submit( void )
{
	int finalFrame;
	int startFrame;
	int frameCount;
	int drop;

	if ( !jka_audioStarted || !dma.buffer ) {
		return;
	}

	finalFrame = jka_audioPaintStart;

	if ( s_paintedtime == jka_audioPaintEnd && finalFrame == jka_audioPaintEnd ) {
		// S_ClearSoundBuffer() calls BeginPainting/memset/Submit without letting
		// S_PaintChannels advance the paint position.  Drop the audio the page
		// already has queued so a seek or load does not keep stale sound.
		JKA_AudioClear();
		return;
	}
	jka_audioPaintEnd = s_paintedtime;

	if ( finalFrame < jka_audioFinalized ) {
		// The mixer was re-based (e.g. after a sound restart): the ring content
		// from the old timeline is no longer valid.
		JKA_AudioClear();
		jka_audioFinalized = finalFrame < 0 ? 0 : finalFrame;
		return;
	}

	startFrame = jka_audioFinalized;
	frameCount = finalFrame - startFrame;
	if ( frameCount <= 0 ) {
		return;
	}

	// A long main-loop stall can leave more than one full ring of final
	// samples.  Only the last ring is still intact.
	drop = frameCount - jka_audioFrames;
	if ( drop > 0 ) {
		startFrame += drop;
		frameCount = jka_audioFrames;
	}

	JKA_AudioSubmitRange( startFrame, frameCount );
	jka_audioFinalized = finalFrame;
}

void SNDDMA_Shutdown( void )
{
	if ( !jka_audioStarted ) {
		return;
	}

	EM_ASM( {
		if ( typeof Module === 'object' && Module.jkaAudio ) {
			Module.jkaAudio.close();
		}
	} );

	free( dma.buffer );
	dma.buffer = NULL;

	jka_audioStarted = qfalse;
	jka_audioFinalized = 0;
	jka_audioPaintStart = 0;
	jka_audioPaintEnd = 0;
	jka_audioFrames = 0;
}

// SDL input still calls this on window focus changes.  The page owns the audio
// context lifecycle, so focus changes do not mute it here.
void SNDDMA_Activate( qboolean activate )
{
	(void)activate;
}
