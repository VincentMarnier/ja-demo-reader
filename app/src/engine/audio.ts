/**
 * Web Audio output for the engine's software mixer.
 *
 * The wasm module never opens an SDL audio device: the Emscripten backend
 * (engine/platform/em_audio.cpp) mixes into its DMA ring and hands the painted
 * frames to this object.  Playback is scheduled on the AudioContext timeline at
 * the frame's absolute time, and `playFrame()` returns the frame that is
 * audible now.  The engine feeds that value back into S_GetSoundtime(), so the
 * mixer stays paced by real playback.
 *
 * The worker host runs the module in a dedicated worker where AudioContext does
 * not exist; there the worker forwards PCM to the page and extrapolates
 * `playFrame()` from the clock messages this object sends.  The class itself
 * only runs on the page.
 */

export interface AudioOpenOptions {
  rate: number;
  frames: number;
  channels: number;
}

/** The engine mixes at 44.1 kHz (`s_khz 44`); ask Web Audio for the same rate. */
const AUDIO_RATE = 44100;
/**
 * Maximum audio queued ahead of playback.  The mixer's 50 ms lead is normal;
 * anything well above that means a stalled frame left audio behind the video.
 * Trimming to this cap drops the stale front and re-aligns instead of keeping
 * a permanent A/V delay.
 */
const MAX_QUEUE_SECONDS = 0.12;

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export class EngineAudioOutput {
  private ctx: AudioContext | null = null;
  private rate = 0;
  private channels = 2;
  private opened = false;
  private clockStarted = false;
  // Scheduling frontier: the engine's next final frame and the AudioContext
  // time it will play at.  Blocks are appended here, not placed on a global
  // frame-to-time anchor, so a ring-counter offset cannot become a delay.
  private nextFrame = 0;
  private nextTime = 0;
  private resync = true;
  private sources = new Set<AudioBufferSourceNode>();
  private firstDataLogged = false;
  private log: (line: string) => void;

  constructor(log: (line: string) => void = () => undefined) {
    this.log = log;
  }

  /** The context's real rate; the engine adopts it as dma.speed. */
  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 0;
  }

  get active(): boolean {
    return !!this.ctx && this.opened;
  }

  get started(): boolean {
    return this.clockStarted;
  }

  /**
   * Create the context while the page still has the user activation from the
   * Start/Play click.  Safe to call more than once.
   */
  async prepare(): Promise<void> {
    if (this.ctx) {
      await this.resume();
      return;
    }

    const page = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = page.AudioContext ?? page.webkitAudioContext;
    if (!Ctor) {
      this.log('JKA_PROFILE audio unavailable: no AudioContext');
      return;
    }

    try {
      // The engine's mixer is fixed at 44.1 kHz (s_khz); asking the context for
      // the same rate avoids a resample that would detune every demo.
      this.ctx = new Ctor({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
    } catch (error) {
      try {
        this.ctx = new Ctor();
      } catch (fallbackError) {
        this.log(`JKA_PROFILE audio unavailable: ${String(error)} / ${String(fallbackError)}`);
        this.ctx = null;
        return;
      }
    }

    this.log(`JKA_PROFILE audio context rate=${this.ctx.sampleRate} state=${this.ctx.state}`);
    await this.resume();
  }

  async resume(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (error) {
        this.log(`JKA_PROFILE audio resume failed: ${String(error)}`);
      }
    }
  }

  /** Keep-warm Stop: freeze the playback clock and drop queued sound. */
  async suspend(): Promise<void> {
    if (!this.ctx) return;
    this.stopSources();
    this.resync = true;
    if (this.ctx.state === 'running') {
      try {
        await this.ctx.suspend();
      } catch {
        // The context may already be closing.
      }
    }
  }

  /**
   * Called by the engine bridge (SNDDMA_Init).  Returns the rate the DMA must
   * use, or 0 when audio is unavailable.
   */
  open(options: AudioOpenOptions): number {
    if (!this.ctx) return 0;

    const frames = isPowerOfTwo(options.frames) ? options.frames : 16384;
    const channels = Math.max(1, Math.min(2, Math.round(options.channels) || 2));
    if (options.rate > 0 && options.rate !== this.ctx.sampleRate) {
      this.log(`JKA_PROFILE audio rate requested=${options.rate} using=${this.ctx.sampleRate}`);
    }

    this.rate = this.ctx.sampleRate;
    this.channels = channels;
    this.opened = true;
    this.clockStarted = false;
    this.resync = true;
    this.firstDataLogged = false;
    this.nextFrame = 0;
    this.nextTime = 0;

    // The frame clock starts on the first PCM block, not here: the engine can
    // take a while to reach its first sound update, and starting the clock at
    // S_Init would make that block arrive late and force a backward resync.
    this.log(`JKA_PROFILE audio open rate=${this.rate} frames=${frames} channels=${channels}`);
    return this.rate;
  }

  /** Absolute frame that is audible now. */
  playFrame(): number {
    const ctx = this.ctx;
    if (!ctx || !this.opened || !this.clockStarted) return 0;
    // Playback is at the scheduled frontier minus the audio still queued in
    // front of it.  Once the queue drains, hold at the frontier instead of
    // pretending silent frames were played.
    const queued = Math.max(0, this.nextTime - ctx.currentTime);
    return Math.max(0, Math.floor(this.nextFrame - queued * this.rate));
  }

  /** One contiguous block of interleaved 16-bit samples from the mixer. */
  writePcm(startFrame: number, samples: Int16Array): void {
    const ctx = this.ctx;
    if (!ctx || !this.opened || samples.length === 0) return;

    const channels = this.channels;
    let count = Math.floor(samples.length / channels);
    if (count <= 0) return;

    if (!this.clockStarted || this.resync) {
      this.clockStarted = true;
      this.resync = false;
      this.nextFrame = startFrame;
      this.nextTime = ctx.currentTime + 0.01;
    }

    if (startFrame < this.nextFrame) {
      // The block overlaps audio already queued for playback.  New sounds may
      // have repainted some samples, so keep only the part not scheduled yet.
      const skip = this.nextFrame - startFrame;
      if (skip >= count) return;
      samples = samples.subarray(skip * channels);
      count -= skip;
      startFrame = this.nextFrame;
    } else if (startFrame > this.nextFrame) {
      // The engine's clock jumped (missed wrap / restarted): drop the old
      // queue and continue from the new block instead of adding a delay.
      this.stopSources();
      this.nextFrame = startFrame;
      this.nextTime = ctx.currentTime + 0.01;
    }

    const queued = this.nextTime - ctx.currentTime;
    if (queued < 0.005) {
      // The queue drained while the engine produced nothing; resume from now.
      this.nextTime = ctx.currentTime + 0.01;
    } else if (queued + count / this.rate > MAX_QUEUE_SECONDS) {
      // Playback fell more than the cap behind (a slow frame produced an
      // oversized burst).  Keep only the newest part so audio catches up with
      // the demo instead of carrying the lag forever.
      this.stopSources();
      const keep = Math.max(1, Math.floor((MAX_QUEUE_SECONDS - 0.01) * this.rate));
      const drop = Math.max(0, count - keep);
      if (drop > 0) {
        samples = samples.subarray(drop * channels);
        count -= drop;
        startFrame += drop;
      }
      this.nextFrame = startFrame;
      this.nextTime = ctx.currentTime + 0.01;
    }
    const when = this.nextTime;

    const buffer = ctx.createBuffer(channels, count, this.rate);
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < count; i++) {
        data[i] = samples[i * channels + channel] / 32768;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      this.sources.delete(source);
    };
    this.sources.add(source);
    source.start(when);

    this.nextFrame += count;
    this.nextTime += count / this.rate;

    if (!this.firstDataLogged) {
      this.firstDataLogged = true;
      this.log(`JKA_PROFILE audio first-pcm frames=${count} at=${when.toFixed(3)}`);
    }
  }

  /** S_ClearSoundBuffer: the engine zeroed the ring; stop queued sound. */
  clear(): void {
    this.stopSources();
    this.resync = true;
  }

  /**
   * Re-anchor playback at an engine frame.  Used when the engine was blocked
   * long enough that its own get-DMA-position call would jump several ring
   * buffers; that confuses the mixer's wrap counter, so the worker resets both
   * clocks to a fresh audio position instead.
   */
  rebase(frame: number): void {
    if (!this.ctx || !this.opened) return;
    this.stopSources();
    this.clockStarted = true;
    this.resync = false;
    this.nextFrame = Math.max(0, frame);
    this.nextTime = this.ctx.currentTime + 0.01;
  }

  close(): void {
    this.log('JKA_PROFILE audio close');
    this.stopSources();
    this.opened = false;
    this.clockStarted = false;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }

  /**
   * The synchronous bridge the wasm module calls via Module.jkaAudio.  Main
   * thread only; the worker forwards to this object over postMessage.
   */
  bridge(): Record<string, unknown> {
    return {
      open: (rate: number, frames: number, channels: number): number =>
        this.open({ rate, frames, channels }),
      submit: (startFrame: number, pcm: ArrayBuffer, count: number): void => {
        const samples = new Int16Array(pcm);
        if (count <= 0 || samples.length < count * this.channels) return;
        this.writePcm(startFrame, samples);
      },
      playFrame: (): number => this.playFrame(),
      clear: (): void => this.clear(),
      close: (): void => this.close(),
      activate: (): void => undefined
    };
  }

  private stopSources(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.sources.clear();
  }
}
