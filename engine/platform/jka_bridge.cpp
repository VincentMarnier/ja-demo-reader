/*
===========================================================================
Copyright (C) 2026 jka-demo-player contributors

This file is part of the OpenJK source code.

OpenJK is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License version 2 as
published by the Free Software Foundation.
===========================================================================
*/

// Small, typed bridge for the browser harness. This is intentionally narrow:
// status and a demo command, no raw pointers or engine internals.

#include <emscripten.h>
#include <emscripten/heap.h>
#include <cstdio>
#include <cstdarg>

#include "client/client.h"
#include "client/cl_cgameapi.h"
#include "qcommon/qcommon.h"

qboolean jka_demoEnded = qfalse;
qboolean jka_engineReady = qfalse;

// M9 diagnostics ------------------------------------------------------------
// The bridge registers nothing at boot (the renderer creates jka_profile
// first), so just read the cvar. PROFILE=1 builds default it to 1.
static qboolean jka_workerMode = qfalse;
static int jka_scanMessages;
static int jka_scanMs;

// M9 Phase 4: keep one loaded demo warm and paused behind the wizard.
static char jka_preparedDemo[128];
static qboolean jka_suspended = qfalse;

// M9 Phase 5: while set, CL_ParseGamestate only rebuilds the client
// configstring/snapshot state and does not load the map or cgame.
qboolean jka_scanOnly = qfalse;

static qboolean JKA_BridgeProfileEnabled( void )
{
	return Cvar_VariableIntegerValue( "jka_profile" ) ? qtrue : qfalse;
}

static void JKA_BridgeProfileLog( const char *fmt, ... )
{
	va_list args;
	char text[512];

	if ( !JKA_BridgeProfileEnabled() ) {
		return;
	}
	va_start( args, fmt );
	Q_vsnprintf( text, sizeof( text ), fmt, args );
	va_end( args );
	Com_Printf( "JKA_PROFILE %s\n", text );
}

// Time-based yields keep the page responsive while a scan/replay runs on the
// main thread. A future worker host disables them: the worker may block.
static void JKA_MaybeYield( int *lastYield )
{
#ifdef __EMSCRIPTEN__
	int now;

	if ( jka_workerMode ) {
		return;
	}
	now = Sys_Milliseconds();
	if ( now - *lastYield < 8 ) {
		return;
	}
	*lastYield = now;
	emscripten_sleep( 0 );
#else
	(void)lastYield;
#endif
}

extern "C" {

// cgame-side bridge (statically linked into the engine).
const char *CG_GetScoreboardJson( void );
void CG_SetFollowClient( int clientNum );
const char *CG_EnableFreeCam( void );
void CG_SetFreeCamPose( float x, float y, float z, float pitch, float yaw, float roll );
void CG_DisableFreeCam( void );

EMSCRIPTEN_KEEPALIVE const char *JKA_StatusJson( void )
{
	static char buffer[1024];
	const char *map = cl.mapname;

	Com_sprintf( buffer, sizeof( buffer ),
		"{\"state\":%d,\"demo\":%d,\"serverTime\":%d,\"snapTime\":%d,"
		"\"clientNum\":%d,\"map\":\"%s\",\"ended\":%d,\"ready\":%d,"
		"\"prepared\":%d,\"suspended\":%d}",
		(int)cls.state,
		clc.demoplaying ? 1 : 0,
		cl.serverTime,
		cl.snap.serverTime,
		clc.clientNum,
		map ? map : "",
		jka_demoEnded ? 1 : 0,
		jka_engineReady ? 1 : 0,
		jka_preparedDemo[0] ? 1 : 0,
		jka_suspended ? 1 : 0 );

	return buffer;
}

EMSCRIPTEN_KEEPALIVE void JKA_StopDemo( void );

static qboolean JKA_ValidDemoName( const char *name )
{
	const char *p;

	if ( !name || !name[0] ) {
		return qfalse;
	}
	// The engine's console tokenizer splits on spaces; quote the name and
	// reject characters that could break out of the quoted argument.
	for ( p = name; *p; p++ ) {
		if ( *p == '"' || *p == '\n' || *p == '\r' || *p == ';' ) {
			Com_Printf( "JKA_PlayDemo: invalid demo name\n" );
			return qfalse;
		}
	}
	return qtrue;
}

static void JKA_StartDemo( const char *name )
{
	Cvar_Set( "cl_allowDownload", "0" );
	Cbuf_AddText( va( "demo \"%s\"\n", name ) );
	Cbuf_Execute();
}

EMSCRIPTEN_KEEPALIVE void JKA_PlayDemo( const char *name )
{
	int profileStart = Sys_Milliseconds();

	if ( !JKA_ValidDemoName( name ) ) {
		return;
	}
	JKA_StartDemo( name );
	jka_preparedDemo[0] = 0;
	jka_suspended = qfalse;
	JKA_BridgeProfileLog( "play name=%s ms=%d", name, Sys_Milliseconds() - profileStart );
}

// M9 Phase 4: load the demo and pause it on the first active frame.  r_m2_pause
// is consumed by the client frame loop once CA_ACTIVE/cgame is reached, so the
// map/cgame and the first frame stay warm behind the wizard.
EMSCRIPTEN_KEEPALIVE void JKA_PrepareDemo( const char *name )
{
	int profileStart = Sys_Milliseconds();

	if ( !JKA_ValidDemoName( name ) ) {
		return;
	}
	if ( !Q_stricmp( jka_preparedDemo, name ) && clc.demoplaying && cls.state == CA_ACTIVE ) {
		JKA_BridgeProfileLog( "prepare name=%s already-warm", name );
		return;
	}

	Cvar_Set( "r_m2_pause", "1" );
	JKA_StartDemo( name );
	Q_strncpyz( jka_preparedDemo, name, sizeof( jka_preparedDemo ) );
	jka_suspended = qfalse;
	emscripten_resume_main_loop();
	JKA_BridgeProfileLog( "prepare name=%s ms=%d", name, Sys_Milliseconds() - profileStart );
}

EMSCRIPTEN_KEEPALIVE void JKA_ResumeDemo( void )
{
	Cvar_Set( "r_m2_pause", "0" );
	jka_suspended = qfalse;
	emscripten_resume_main_loop();
	JKA_BridgeProfileLog( "resume-demo name=%s", jka_preparedDemo );
}

// Keep the scene loaded but stop rendering/advancing it.  This is the Stop
// path: no CL_Disconnect, no renderer restart, no duplicate map load.
EMSCRIPTEN_KEEPALIVE void JKA_Suspend( void )
{
	Cvar_Set( "r_m2_pause", "0" );
	jka_suspended = qtrue;
	emscripten_pause_main_loop();
	JKA_BridgeProfileLog( "suspend name=%s", jka_preparedDemo );
}

// Explicit "Release memory": the only path that performs the full teardown.
EMSCRIPTEN_KEEPALIVE void JKA_Release( void )
{
	int profileStart = Sys_Milliseconds();

	JKA_StopDemo();
	jka_preparedDemo[0] = 0;
	jka_suspended = qfalse;
	Cvar_Set( "r_m2_pause", "0" );
	JKA_BridgeProfileLog( "release ms=%d", Sys_Milliseconds() - profileStart );
}

EMSCRIPTEN_KEEPALIVE void JKA_StopDemo( void )
{
	char message[] = "Server disconnected";
	int profileStart = Sys_Milliseconds();

	jka_preparedDemo[0] = 0;
	jka_suspended = qfalse;

	// The console "disconnect" command routes through Com_Error(), which
	// throws an int on ERR_DISCONNECT. That throw has no C++ catch frame when
	// this is called from JavaScript, so it would escape the ccall and abort
	// the UI handler. Perform the same teardown directly instead.
	if ( cls.state == CA_DISCONNECTED ) {
		return;
	}
	SV_Shutdown( message );
	CL_Disconnect( qtrue );
	CL_FlushMemory();
	FS_PureServerSetLoadedPaks( "", "" );
	JKA_BridgeProfileLog( "stop ms=%d", Sys_Milliseconds() - profileStart );
}

EMSCRIPTEN_KEEPALIVE void JKA_SetPaused( int paused )
{
	Cvar_Get( "r_m2_pause", "0", 0 );
	Cvar_Set( "r_m2_pause", paused ? "1" : "0" );
}

EMSCRIPTEN_KEEPALIVE void JKA_Resume( void )
{
	jka_suspended = qfalse;
	emscripten_resume_main_loop();
}

// Phase 3 host switch: a worker must not Asyncify-yield in the scan/seek
// loops, because its JS event loop does not drive the page.
EMSCRIPTEN_KEEPALIVE void JKA_SetWorkerMode( int worker )
{
	jka_workerMode = worker ? qtrue : qfalse;
}

// Heap numbers the JS side cannot see from Module. MEMFS/OPFS/JS-heap numbers
// are added by EngineHost's memory line.
EMSCRIPTEN_KEEPALIVE const char *JKA_MemoryJson( void )
{
	static char buffer[256];

	Com_sprintf( buffer, sizeof( buffer ),
		"{\"heap\":%u,\"heapMax\":%u,\"hunkFree\":%d}",
		(unsigned int)emscripten_get_heap_size(),
		(unsigned int)emscripten_get_heap_max(),
		Hunk_MemoryRemaining() );
	return buffer;
}

// ---------------------------------------------------------------------------
// Demo scan summary
//
// The stock client has no demo index.  While the demo is scanned for its
// duration we also collect the map, player records and obituary events so the
// UI can show a resume and compute exact kills/deaths at any seek target.
// ---------------------------------------------------------------------------

#define JKA_MAX_GAMES       8
#define JKA_MAX_RECORDS     96
#define JKA_MAX_EVENTS      16000
#define JKA_MAX_VITALS      20000
#define JKA_SUMMARY_SIZE    (16 * 1024 * 1024)

typedef struct {
	int			num;
	char		name[64];
	int			team;
	int			kills;
	int			deaths;
	int			firstSeen;
	int			lastSeen;
	int			leftAt;
	qboolean	active;
	qboolean	left;
	qboolean	returned;
	qboolean	placeholder;
} jkaPlayerRecord_t;

typedef struct {
	int			time;
	int			target;
	int			attacker;
	int			mod;
	unsigned char	friendly;	// 1 when attacker and target shared team 1/2
} jkaEvent_t;

// Health/armor timeline.  Every sample is "the target's vitals at this server
// time"; the app replays them up to the seek target to draw the scoreboard.
//
// Base JKA snapshots do not carry remote health or armor, so the scan uses
// every source that does transmit them: the team overlay server command
// (`tinfo`), the duel health configstrings, the demo client's own
// playerState, and the EV_PAIN damage event, whose eventParm is the target's
// remaining health.  Players never sampled keep the spawn defaults (100/25).
typedef struct {
	int		time;
	short	num;
	short	health;
	short	armor;
	unsigned char	source;
} jkaVitals_t;

#define JKA_VITALS_SPAWN	0
#define JKA_VITALS_DEATH	1
#define JKA_VITALS_PAIN		2
#define JKA_VITALS_TEAMINFO	3
#define JKA_VITALS_DUEL		4
#define JKA_VITALS_SELF		5

#define JKA_MAX_STANCES	8000

// Saber stance timeline.  Base JKA mirrors playerState.fd.saberAnimLevel into
// entityState.fireflag for every player, so the current stance is available for
// remote players too (the wire field is 2 bits, so it covers none/fast/medium/
// strong; dual and staff arrive as their truncated values).
typedef struct {
	int		time;
	short	num;
	short	stance;
} jkaStance_t;

#define JKA_MAX_DAMAGES	12000

// One observed damage instance.  attacker is -1 when the demo gives no
// attribution (hitscan guns, force, world damage and unseen hits).
typedef struct {
	int		time;
	short	target;
	short	attacker;
	short	damage;
	unsigned char	source;
	unsigned char	friendly;	// 1 when attacker and target shared team 1/2
} jkaDamage_t;

#define JKA_MAX_SWINGS	16000
#define JKA_MAX_SABERS	64
#define JKA_MAX_SABER_NAME	32

// One saber swing.  The demo has no input keys, but the server mirrors the
// resolved playerState.saberMove into entityState, and that move is exactly
// the swing the player made (forward+attack became LS_A_T2B, and so on).
// hits counts EV_SABER_HIT events; damage is the health loss the scan could
// attribute to those hits (0 when the demo never exposes the target's health).
typedef struct {
	int		time;
	short	num;
	short	move;
	short	damage;
	unsigned char	stance;
	unsigned char	saber;	// index into jkaGame_t.sabers
	unsigned char	hits;
} jkaSwing_t;

// Saber names from CS_PLAYERS ("st"), interned per game so every swing can
// carry a stable id.  Index 0 is always "unknown".
typedef struct {
	char	name[JKA_MAX_SABER_NAME];
} jkaSaber_t;

#define JKA_MAX_SABER_HITS	8000
#define JKA_MAX_BLOCKS		4000

#define JKA_STATE_GROUND	0
#define JKA_STATE_AIR		1
#define JKA_STATE_LAND		2
// "Just landed" lasts about as long as the landing animation.
#define JKA_LAND_WINDOW		400
// A broken parry is resolved in the same server frame as the hit that caused
// it; keep a little slack for the snapshot the scan sees it in.
#define JKA_BLOCK_WINDOW	300

// One saber contact event (EV_SABER_HIT) with both players' movement state at
// that moment (JKA_STATE_*).  Used for the air / ground / just-landed stats.
typedef struct {
	int		time;
	short	attacker;
	short	target;
	unsigned char	attackerState;
	unsigned char	targetState;
} jkaSaberHit_t;

// A broken guard: the loser was parrying (LS_PARRY_*) and the winner's strike
// broke the parry (LS_H1_*), leaving the loser exposed.  winner is -1 when the
// demo does not identify the attacker.
typedef struct {
	int		time;
	short	winner;
	short	loser;
	unsigned char	kind;	// 1 guard broken (H1), 2 saber knocked away (V1)
} jkaBlock_t;

#define JKA_DAMAGE_UNKNOWN	0
#define JKA_DAMAGE_SABER	1
#define JKA_DAMAGE_MISSILE	2
#define JKA_DAMAGE_POV_OUT	3
#define JKA_DAMAGE_POV_IN	4
#define JKA_DAMAGE_KILL		5

#define JKA_MAX_PENDING_HITS	24

typedef struct {
	int		time;
	short	attacker;
	short	swing;	// index+1 into the game's swings, 0 when not in a swing
	unsigned char	source;
} jkaPendingHit_t;

// ---------------------------------------------------------------------------
// Input-script (macro) scan
//
// Port of the proxy's anti-macro guard (`proxy_sv_antiMacro`) to demo data.
// The proxy watches the *raw usercmd stream* and flags a channel that reverses
// faster and more regularly than a hand can: a config macro flips a movement
// axis or a turn key every few commands (`wait N`), and its hold lengths are
// frame-exact.  A demo does not contain usercmds — only the server messages the
// recorded client received — so the observable signal is the **view angles the
// per-snapshot playerState/entityState carry**, sampled at the server frame
// rate (JKA's `sv_fps` defaults to 40, i.e. 25 ms).
//
// Consequences for the port:
//
// * Only the **view** channel exists.  `forwardmove`/`rightmove`/`upmove` and
//   the attack button mask are not in a demo, and the resulting velocity and
//   saber move cannot be inverted back into the input that produced them.
//   Flagging them from the output would be a guess, so they are not scanned.
// * Detection is the proxy's **run** structure, not a time window: reversals
//   are chained while the gap since the previous one stays within
//   `JKA_SCRIPT_RUN_GAP_MS`, and a longer gap starts a new run.  A macro press
//   is a burst of reversals; the gaps between presses are not part of it.
// * The proxy's hold-spread test ("`wait N` is exact in milliseconds") is not
//   usable here: at 25 ms sampling a 55 ms hold is two or three snapshots, so
//   the exactness is quantised away.  The remaining tests are the ones that
//   survive downsampling:
//   1. **rate** — the mean interval between reversals is at most
//      `JKA_SCRIPT_MAX_MEAN_MS` (100 ms ≈ 10 reversals/s).  At the stock
//      `sv_fps 40` a macro burst shows a reversal every one to three snapshots;
//      a hand alternates at 5-8/s (125-200 ms) and cannot build a run of five
//      inside the threshold at that cadence.
//   2. **shape** — every sample of the run moves the view by a similar step
//      (mean at least 75 % of the peak).  A held turn key is full speed on
//      every command, so its snapshots are bang-bang; a hand-driven mouse
//      wiggle accelerates and decelerates (a sinusoid sits near 64 %).  This
//      is the test that separates a key macro from a mouse, exactly as in the
//      proxy, and it is only weakened by snapshot boundary samples that split
//      a reversal.
//   3. **swing** — the run moves the view by at least 2 degrees peak to peak;
//      a sub-degree tremor is not the blade-wiggle payoff.
// * A channel that has fired stays "wary" for `JKA_SCRIPT_WARY_MS`; the next
//   burst is flagged after four reversals instead of five, so a bind pressed
//   over and over is caught earlier.  Runs closer than `JKA_SCRIPT_MERGE_MS`
//   to the same player's previous flag are merged into it, so one bind used
//   repeatedly reads as one finding with its burst span.
//
// A run that is faster than the snapshot rate aliases: a 55 ms macro sampled
// at 25 ms is still visible as a reversal per snapshot or two, but a burst
// under one snapshot interval can fold into a constant angle, and a script
// whose period matches the snapshot interval exactly can look steady.  The UI
// wording ("possible") is deliberate; this is evidence, not proof.
// ---------------------------------------------------------------------------

#define JKA_SCRIPT_CHANNELS		2
#define JKA_SCRIPT_CH_YAW		0
#define JKA_SCRIPT_CH_PITCH		1

#define JKA_SCRIPT_MAX_FLAGS	128

/// A reversal chained to the previous one within this gap belongs to the same
/// run (proxy `RUN_MAX_GAP_MS`).
#define JKA_SCRIPT_RUN_GAP_MS	200

/// A larger gap in a player's samples (pause, PVS exit, POV switch, seek)
/// forgets the run and the angle baseline (proxy `STALE_GAP_MS`).
#define JKA_SCRIPT_STALE_MS		400

/// Reversals needed for the rate test, and the wary shortcut.  The proxy fires
/// at four because per-command samples make four reversals machine-exact; a
/// snapshot rate cannot tell four quick hand flicks from a four-hold bind, so a
/// first press needs five here and a repeat of an already-flagged bind (wary)
/// needs four.
#define JKA_SCRIPT_MIN_REVERSALS	5
#define JKA_SCRIPT_WARY_REVERSALS	4
#define JKA_SCRIPT_WARY_MS			3000

/// Mean interval ceiling between reversals, milliseconds.  Demo-calibrated:
/// the proxy's 65 ms is a per-command figure; at snapshot resolution a burst
/// shows one reversal every 25-75 ms and a hand's rhythm starts at 125 ms.
#define JKA_SCRIPT_MAX_MEAN_MS		100

/// View noise floor in `ANGLE2SHORT` units (36 ≈ 0.2°): a partially held turn
/// frame between two snapshots says nothing (proxy `ANGLE_MIN_STEP`).
#define JKA_SCRIPT_MIN_STEP			36

/// Key-shape test: mean per-sample step as a percentage of the peak (proxy
/// `VIEW_STEP_MEAN_PERCENT`).
#define JKA_SCRIPT_STEP_PERCENT		75

/// Minimum view swing over the run, `ANGLE2SHORT` units (364 ≈ 2° peak to
/// peak; proxy `VIEW_MIN_SWING`).
#define JKA_SCRIPT_MIN_SWING		364

/// Consecutive findings for the same player and channel closer than this are
/// one burst in the UI.
#define JKA_SCRIPT_MERGE_MS			1500

/// "Strong" needs a longer burst, a faster cadence, a key-like shape and a
/// wider swing than the bare thresholds.
#define JKA_SCRIPT_STRONG_REVERSALS	6
#define JKA_SCRIPT_STRONG_MEAN_MS	60
#define JKA_SCRIPT_STRONG_PERCENT	85
#define JKA_SCRIPT_STRONG_SWING		546

/// One channel's run accounting for one player.
typedef struct {
	qboolean	saw;			// a previous directional sample exists
	int			sign;			// sign of the previous sample (-1/1)
	int			flipTime;		// time of the previous reversal
	int			unwrapped;		// continuous angle, for the swing measure
	int			runCount;		// reversals in the current run
	int			runFirstTime;	// first reversal of the run
	int			waryUntil;		// wary deadline after a finding
	long long		stepSum;		// per-sample |delta|: sum/count/max
	int			stepCount;
	int			stepMax;
	int			swingMin;
	int			swingMax;
} jkaScriptRun_t;

/// One player's view-angle baseline and per-channel run state.
typedef struct {
	qboolean		seen;
	int				lastTime;
	int				yaw;
	int				pitch;
	jkaScriptRun_t	run[JKA_SCRIPT_CHANNELS];
} jkaScriptTrack_t;

/// One finding, grouped per game and rendered in the UI.
typedef struct {
	int				time;		// first reversal of the burst
	int				endTime;	// last reversal merged into it
	short			num;
	unsigned char	channel;	// JKA_SCRIPT_CH_*
	unsigned char	reversals;
	unsigned char	bursts;		// separate runs merged into this finding
	unsigned char	confidence;	// 1 strong, 0 possible
	short			meanMs;
	short			swing;		// tenths of a degree
	unsigned char	stepPercent;
	unsigned char	samples;	// directional snapshots in the run
} jkaScriptFlag_t;

#define JKA_MAX_KEYFRAMES 96

typedef struct {
	clSnapshot_t	snap;
	gameState_t		gameState;
	entityState_t	entities[MAX_SNAPSHOT_ENTITIES];
	int			entityCount;
	int			resumeOffset;
	int			serverCommandSequence;
	int			lastExecutedServerCommand;
	int			clientNum;
	int			gameIndex;
	int			time;
} jkaKeyframe_t;

typedef struct {
	int			gamestateId;
	char		map[128];
	entityState_t	baselines[MAX_GENTITIES];
	qboolean	hasBaselines;
	int			startTime;
	int			endTime;
	int			levelStartTime;
	int			observedLevelStartTime;
	jkaPlayerRecord_t players[JKA_MAX_RECORDS];
	int			playerCount;
	jkaEvent_t	events[JKA_MAX_EVENTS];
	int			eventCount;
	qboolean	eventOverflow;
	jkaVitals_t	vitals[JKA_MAX_VITALS];
	int			vitalsCount;
	qboolean	vitalsOverflow;
	jkaStance_t	stances[JKA_MAX_STANCES];
	int			stanceCount;
	qboolean	stanceOverflow;
	jkaDamage_t	damages[JKA_MAX_DAMAGES];
	int			damageCount;
	qboolean	damageOverflow;
	jkaSwing_t	swings[JKA_MAX_SWINGS];
	int			swingCount;
	qboolean	swingOverflow;
	jkaSaberHit_t	saberHits[JKA_MAX_SABER_HITS];
	int			saberHitCount;
	qboolean	saberHitOverflow;
	jkaBlock_t	blocks[JKA_MAX_BLOCKS];
	int			blockCount;
	qboolean	blockOverflow;
	// View-angle input-script findings (see the input-script scan above).
	jkaScriptFlag_t	scripts[JKA_SCRIPT_MAX_FLAGS];
	int			scriptCount;
	qboolean	scriptOverflow;
	jkaSaber_t	sabers[JKA_MAX_SABERS];
	int			saberCount;
	int			pov;	// recorded client (clc.clientNum), -1 when unknown
} jkaGame_t;

static jkaGame_t	jka_games[JKA_MAX_GAMES];
static int			jka_gameCount;
static int			jka_currentGame;
static int			jka_slotRecord[MAX_CLIENTS];
static unsigned int	jka_slotHash[MAX_CLIENTS];
static int			jka_firstTime;
static int			jka_lastTime;
static int			jka_fullSnapshots;
static int			jka_totalSnapshots;
static int			jka_levelStartChanges;
static int			jka_mapRestartCount;
static int			jka_lastCommandSeq;
static qboolean		jka_pendingGameReset;
static int			jka_lastSnapMessageNum;
static int			jka_lastEventTime;
static int			jka_lastEventTarget;
static int			jka_lastEventAttacker;
static int			jka_lastEventMod;
static int			jka_snapshotSerial;
static jkaKeyframe_t	jka_keyframes[JKA_MAX_KEYFRAMES];
static int			jka_keyframeCount;
static int			jka_lastKeyframeTime;
static int			jka_eventEntitySeen[MAX_GENTITIES];
static int			jka_eventEntityValue[MAX_GENTITIES];
static int			jka_entityEventValue[MAX_CLIENTS];
static int			jka_slotHealth[MAX_CLIENTS];
static int			jka_slotArmor[MAX_CLIENTS];
static int			jka_slotStance[MAX_CLIENTS];
static int			jka_slotMove[MAX_CLIENTS];
static int			jka_slotTorsoFlip[MAX_CLIENTS];
static int			jka_slotSwing[MAX_CLIENTS];	// index+1 into game->swings
static int			jka_slotSaber[MAX_CLIENTS];	// index into game->sabers
static qboolean		jka_slotGrounded[MAX_CLIENTS];
static int			jka_slotLandedAt[MAX_CLIENTS];
static qboolean		jka_slotBroken[MAX_CLIENTS];
static int			jka_slotLastHitTime[MAX_CLIENTS];
static int			jka_slotLastHitAttacker[MAX_CLIENTS];
static int			jka_slotLastHitByTime[MAX_CLIENTS];
static int			jka_slotLastHitByTarget[MAX_CLIENTS];
static qboolean		jka_slotDead[MAX_CLIENTS];
static qboolean		jka_slotKnown[MAX_CLIENTS];
static qboolean		jka_predictablePain[MAX_CLIENTS];
static jkaPendingHit_t	jka_pendingHits[MAX_CLIENTS][JKA_MAX_PENDING_HITS];
static int			jka_pendingHitCount[MAX_CLIENTS];
static int			jka_missileEventValue[MAX_GENTITIES];
static int			jka_lastDamageIndex[MAX_CLIENTS];
static int			jka_lastPovHits;
static char			jka_summary[JKA_SUMMARY_SIZE];
static qboolean		jka_summaryValid = qfalse;

// Player trajectories for the minimap trails.  A demo is a recording, so the
// "next five seconds" only exists inside the scan: the parse-only pass samples
// every player's position and the page asks for a time window around the live
// server time.  Samples use the same clock as JKA_RadarJson so they line up
// with the live dots; positions are rounded later, in the JSON writer.
#define JKA_MAX_TRAJECTORY_SAMPLES	262144
#define JKA_TRAJECTORY_INTERVAL_MS	150
#define JKA_TRAJECTORY_BUFFER_SIZE	(256 * 1024)

typedef struct {
	int		time;
	float	x;
	float	y;
	short	num;
	short	pad;
} jkaTrajectorySample_t;

static jkaTrajectorySample_t	jka_trajectory[JKA_MAX_TRAJECTORY_SAMPLES];
static int						jka_trajectoryCount;
static int						jka_trajectoryLastTime = -1;
static qboolean					jka_trajectoryOverflow;
static char						jka_trajectoryJson[JKA_TRAJECTORY_BUFFER_SIZE];

// Incremented by CL_ParseGamestate; lets the scan split map loads and restarts
// into separate games.  Defined with C++ linkage, so keep it outside the
// extern "C" block above.
int jka_demoGamestates = 0;

static const char *JKA_ConfigString( int index )
{
	int offset;

	if ( index < 0 || index >= MAX_CONFIGSTRINGS ) {
		return "";
	}
	offset = cl.gameState.stringOffsets[index];
	if ( !offset ) {
		return "";
	}
	return cl.gameState.stringData + offset;
}

static unsigned int JKA_HashString( const char *s )
{
	unsigned int hash = 2166136261u;

	while ( s && *s ) {
		hash ^= (unsigned char)*s++;
		hash *= 16777619u;
	}
	return hash;
}

static void JKA_JsonEscape( const char *src, char *dst, size_t size )
{
	size_t d = 0;

	if ( !size ) {
		return;
	}
	while ( src && *src && d + 7 < size ) {
		unsigned char c = (unsigned char)*src++;
		if ( c == '"' || c == '\\' ) {
			dst[d++] = '\\';
			dst[d++] = (char)c;
		} else if ( c < 32 ) {
			d += (size_t)snprintf( dst + d, size - d, "\\u%04x", c );
		} else {
			dst[d++] = (char)c;
		}
	}
	dst[d] = 0;
}

static void JKA_ResetScriptTracks( void );

static void JKA_ResetSummary( void )
{
	Com_Memset( jka_games, 0, sizeof( jka_games ) );
	jka_gameCount = 0;
	jka_currentGame = -1;
	jka_firstTime = 0;
	jka_lastTime = 0;
	jka_fullSnapshots = 0;
	jka_totalSnapshots = 0;
	jka_levelStartChanges = 0;
	jka_mapRestartCount = 0;
	jka_lastCommandSeq = 0;
	jka_pendingGameReset = qfalse;
	jka_lastSnapMessageNum = -1;
	jka_lastEventTime = -1;
	jka_lastEventTarget = -1;
	jka_lastEventAttacker = -1;
	jka_lastEventMod = -1;
	jka_snapshotSerial = 0;
	jka_keyframeCount = 0;
	jka_lastKeyframeTime = 0;
	jka_lastPovHits = -1;
	JKA_ResetScriptTracks();
	Com_Memset( jka_eventEntitySeen, 0, sizeof( jka_eventEntitySeen ) );
	Com_Memset( jka_eventEntityValue, 0, sizeof( jka_eventEntityValue ) );
	Com_Memset( jka_predictablePain, 0, sizeof( jka_predictablePain ) );
	Com_Memset( jka_missileEventValue, 0, sizeof( jka_missileEventValue ) );
	Com_Memset( jka_pendingHitCount, 0, sizeof( jka_pendingHitCount ) );
	jka_summary[0] = 0;
	jka_summaryValid = qfalse;
	jka_trajectoryCount = 0;
	jka_trajectoryLastTime = -1;
	jka_trajectoryOverflow = qfalse;
	for ( int i = 0; i < MAX_CLIENTS; i++ ) {
		jka_slotRecord[i] = -1;
		jka_slotHash[i] = 0;
		jka_slotHealth[i] = 100;
		jka_slotArmor[i] = 25;
		jka_slotStance[i] = -1;
		jka_slotMove[i] = 0;
		jka_slotTorsoFlip[i] = 0;
		jka_slotSwing[i] = 0;
		jka_slotSaber[i] = 0;
		jka_slotGrounded[i] = qtrue;
		jka_slotLandedAt[i] = 0;
		jka_slotBroken[i] = qfalse;
		jka_slotLastHitTime[i] = -1;
		jka_slotLastHitAttacker[i] = -1;
		jka_slotLastHitByTime[i] = -1;
		jka_slotLastHitByTarget[i] = -1;
		jka_slotDead[i] = qfalse;
		jka_slotKnown[i] = qfalse;
		jka_lastDamageIndex[i] = -1;
		jka_entityEventValue[i] = 0;
	}
}

static jkaGame_t *JKA_CurrentGame( void )
{
	if ( jka_currentGame < 0 || jka_currentGame >= jka_gameCount ) {
		return NULL;
	}
	return &jka_games[jka_currentGame];
}

static void JKA_ResetSlotVitals( int slot )
{
	if ( slot < 0 || slot >= MAX_CLIENTS ) {
		return;
	}
	jka_slotHealth[slot] = 100;
	jka_slotArmor[slot] = 25;
	jka_slotStance[slot] = -1;
	jka_slotMove[slot] = 0;
	jka_slotTorsoFlip[slot] = 0;
	jka_slotSwing[slot] = 0;
	jka_slotGrounded[slot] = qtrue;
	jka_slotLandedAt[slot] = 0;
	jka_slotBroken[slot] = qfalse;
	jka_slotLastHitTime[slot] = -1;
	jka_slotLastHitAttacker[slot] = -1;
	jka_slotLastHitByTime[slot] = -1;
	jka_slotLastHitByTarget[slot] = -1;
	jka_slotDead[slot] = qfalse;
	jka_slotKnown[slot] = qfalse;
	jka_pendingHitCount[slot] = 0;
	jka_lastDamageIndex[slot] = -1;
	jka_entityEventValue[slot] = 0;
}

static jkaPlayerRecord_t *JKA_ActiveRecord( jkaGame_t *game, int slot )
{
	int index;

	if ( !game || slot < 0 || slot >= MAX_CLIENTS ) {
		return NULL;
	}
	index = jka_slotRecord[slot];
	if ( index < 0 || index >= game->playerCount ) {
		return NULL;
	}
	if ( !game->players[index].active ) {
		return NULL;
	}
	return &game->players[index];
}

static jkaPlayerRecord_t *JKA_AddRecord( jkaGame_t *game, int slot, const char *name,
	int team, int now, qboolean placeholder )
{
	jkaPlayerRecord_t *record;

	if ( !game || game->playerCount >= JKA_MAX_RECORDS ) {
		return NULL;
	}
	record = &game->players[game->playerCount++];
	Com_Memset( record, 0, sizeof( *record ) );
	record->num = slot;
	record->team = team;
	record->firstSeen = now;
	record->lastSeen = now;
	record->active = qtrue;
	record->placeholder = placeholder;
	Q_strncpyz( record->name, name && name[0] ? name : va( "Client %d", slot ), sizeof( record->name ) );
	return record;
}

static jkaPlayerRecord_t *JKA_FindClosedRecord( jkaGame_t *game, const char *name )
{
	int i;

	if ( !game || !name || !name[0] ) {
		return NULL;
	}
	for ( i = game->playerCount - 1; i >= 0; i-- ) {
		if ( !game->players[i].active && !Q_stricmp( game->players[i].name, name ) ) {
			return &game->players[i];
		}
	}
	return NULL;
}

static void JKA_CloseSlot( jkaGame_t *game, int slot, int now )
{
	jkaPlayerRecord_t *record = JKA_ActiveRecord( game, slot );

	JKA_ResetSlotVitals( slot );
	if ( !record ) {
		jka_slotRecord[slot] = -1;
		jka_slotSaber[slot] = 0;
		return;
	}
	record->active = qfalse;
	record->left = qtrue;
	record->leftAt = now;
	record->lastSeen = now;
	jka_slotRecord[slot] = -1;
	jka_slotSaber[slot] = 0;
}

static void JKA_EnsureRecord( jkaGame_t *game, int slot, int now )
{
	jkaPlayerRecord_t *record = JKA_ActiveRecord( game, slot );
	char name[64];

	if ( record || !game ) {
		return;
	}
	Com_sprintf( name, sizeof( name ), "Client %d", slot );
	record = JKA_AddRecord( game, slot, name, 0, now, qtrue );
	if ( record ) {
		jka_slotRecord[slot] = game->playerCount - 1;
	}
}

static qboolean JKA_IsSpectator( int slot )
{
	jkaPlayerRecord_t *record = JKA_ActiveRecord( JKA_CurrentGame(), slot );

	return ( record && record->team == 3 ) ? qtrue : qfalse;
}

// Team 1/2 is a real team; team 0 is free-for-all and team 3 is spectator.
// In FFA every other player is an opponent, so ally damage is never subtracted.
static int JKA_SameTeam( jkaGame_t *game, int attacker, int target )
{
	jkaPlayerRecord_t *a;
	jkaPlayerRecord_t *t;
	int team;

	if ( !game || attacker < 0 || attacker >= MAX_CLIENTS || target < 0 || target >= MAX_CLIENTS ) {
		return 0;
	}
	a = JKA_ActiveRecord( game, attacker );
	t = JKA_ActiveRecord( game, target );
	if ( !a || !t || a->team != t->team ) {
		return 0;
	}
	team = a->team;
	return ( team == 1 || team == 2 ) ? 1 : 0;
}

static void JKA_EmitVitals( jkaGame_t *game, int now, int num, int health, int armor, int source )
{
	jkaVitals_t *sample;

	if ( !game ) {
		return;
	}
	if ( game->vitalsCount >= JKA_MAX_VITALS ) {
		game->vitalsOverflow = qtrue;
		return;
	}
	sample = &game->vitals[game->vitalsCount++];
	sample->time = now;
	sample->num = (short)num;
	sample->health = (short)health;
	sample->armor = (short)armor;
	sample->source = (unsigned char)source;
}

static void JKA_EmitStance( jkaGame_t *game, int now, int num, int stance )
{
	jkaStance_t *sample;

	if ( !game ) {
		return;
	}
	if ( game->stanceCount >= JKA_MAX_STANCES ) {
		game->stanceOverflow = qtrue;
		return;
	}
	sample = &game->stances[game->stanceCount++];
	sample->time = now;
	sample->num = (short)num;
	sample->stance = (short)stance;
}

// Saber names ("st" in CS_PLAYERS) are interned per game.  Index 0 is
// reserved for players with no saber or a clientinfo that has not arrived yet.
static int JKA_SaberId( jkaGame_t *game, const char *name )
{
	int i;

	if ( !game ) {
		return 0;
	}
	if ( !name || !name[0] ) {
		name = "none";
	}
	for ( i = 0; i < game->saberCount; i++ ) {
		if ( !Q_stricmp( game->sabers[i].name, name ) ) {
			return i;
		}
	}
	if ( game->saberCount >= JKA_MAX_SABERS ) {
		return 0;
	}
	i = game->saberCount++;
	Q_strncpyz( game->sabers[i].name, name, sizeof( game->sabers[i].name ) );
	return i;
}

// entityState.fireflag is only two bits, so the staff (7) and dual (6) styles
// arrive truncated.  The clientinfo saber name identifies them exactly, which
// is the same correction the cgame applies to a followed player (patch 0012).
static int JKA_SaberStance( jkaGame_t *game, int saber, int stance )
{
	const char *name;

	name = ( game && saber >= 0 && saber < game->saberCount ) ? game->sabers[saber].name : "";
	if ( !Q_stricmpn( name, "staff_", 6 ) ) {
		return SS_STAFF;
	}
	if ( !Q_stricmpn( name, "dual_", 5 ) ) {
		return SS_DUAL;
	}
	return stance;
}

// Mirror of BG_SaberInAttack() (bg_panimate.c) for the client-side scan: the
// moves that do full attack damage.  Bounces, parries, deflects and
// knockaways are reactions, not swings, so they are deliberately absent.
static qboolean JKA_SaberMoveIsAttack( int move )
{
	if ( move >= LS_A_TL2BR && move <= LS_A_T2B ) {
		return qtrue;
	}
	switch ( move ) {
	case LS_A_BACK:
	case LS_A_BACK_CR:
	case LS_A_BACKSTAB:
	case LS_ROLL_STAB:
	case LS_A_LUNGE:
	case LS_A_JUMP_T__B_:
	case LS_A_FLIP_STAB:
	case LS_A_FLIP_SLASH:
	case LS_JUMPATTACK_DUAL:
	case LS_JUMPATTACK_ARIAL_LEFT:
	case LS_JUMPATTACK_ARIAL_RIGHT:
	case LS_JUMPATTACK_CART_LEFT:
	case LS_JUMPATTACK_CART_RIGHT:
	case LS_JUMPATTACK_STAFF_LEFT:
	case LS_JUMPATTACK_STAFF_RIGHT:
	case LS_BUTTERFLY_LEFT:
	case LS_BUTTERFLY_RIGHT:
	case LS_A_BACKFLIP_ATK:
	case LS_SPINATTACK_DUAL:
	case LS_SPINATTACK:
	case LS_LEAP_ATTACK:
	case LS_SWOOP_ATTACK_RIGHT:
	case LS_SWOOP_ATTACK_LEFT:
	case LS_TAUNTAUN_ATTACK_RIGHT:
	case LS_TAUNTAUN_ATTACK_LEFT:
	case LS_KICK_F:
	case LS_KICK_B:
	case LS_KICK_R:
	case LS_KICK_L:
	case LS_KICK_S:
	case LS_KICK_BF:
	case LS_KICK_RL:
	case LS_KICK_F_AIR:
	case LS_KICK_B_AIR:
	case LS_KICK_R_AIR:
	case LS_KICK_L_AIR:
	case LS_STABDOWN:
	case LS_STABDOWN_STAFF:
	case LS_STABDOWN_DUAL:
	case LS_DUAL_SPIN_PROTECT:
	case LS_STAFF_SOULCAL:
	case LS_A1_SPECIAL:
	case LS_A2_SPECIAL:
	case LS_A3_SPECIAL:
	case LS_UPSIDE_DOWN_ATTACK:
	case LS_PULL_ATTACK_STAB:
	case LS_PULL_ATTACK_SWING:
	case LS_SPINATTACK_ALORA:
	case LS_DUAL_FB:
	case LS_DUAL_LR:
	case LS_HILT_BASH:
		return qtrue;
	}
	return qfalse;
}

// One swing starts when the player enters an attack move, chains into a
// different attack move, or restarts the same attack move (torsoFlip toggles
// exactly when the same animation restarts).  Leaving the attack moves ends it.
static void JKA_EmitSwing( jkaGame_t *game, int now, int num, int move, int stance, int saber )
{
	jkaSwing_t *swing;

	if ( !game || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( game->swingCount >= JKA_MAX_SWINGS ) {
		game->swingOverflow = qtrue;
		jka_slotSwing[num] = 0;
		return;
	}
	swing = &game->swings[game->swingCount];
	Com_Memset( swing, 0, sizeof( *swing ) );
	swing->time = now;
	swing->num = (short)num;
	swing->move = (short)move;
	swing->stance = (unsigned char)stance;
	swing->saber = (unsigned char)saber;
	jka_slotSwing[num] = ++game->swingCount;
}

static void JKA_TrackSwingState( jkaGame_t *game, int now, int num, int move, int stance,
	int saber, int torsoFlip, qboolean inFlight, qboolean dead )
{
	qboolean start = qfalse;

	if ( !game || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( JKA_IsSpectator( num ) || dead ) {
		jka_slotSwing[num] = 0;
		return;
	}
	if ( !JKA_SaberMoveIsAttack( move ) || inFlight ) {
		jka_slotSwing[num] = 0;
	} else if ( move != jka_slotMove[num] || torsoFlip != jka_slotTorsoFlip[num] ) {
		start = qtrue;
	} else if ( !jka_slotSwing[num] ) {
		start = qtrue;
	}
	jka_slotMove[num] = move;
	jka_slotTorsoFlip[num] = torsoFlip;
	if ( start ) {
		JKA_EmitSwing( game, now, num, move, stance, saber );
	}
}

// The parry-broken animation (LS_H1_*) is the game's "the attacker broke the
// defender's guard" outcome: the defender is staggered and exposed.  V1 is the
// mirrored outcome for the attacker whose strike was knocked away, which also
// leaves them exposed.  Both are resolved as block exchanges; V1 from a wall
// bounce has no recent saber contact and is ignored below.
static qboolean JKA_SaberMoveIsBrokenParry( int move )
{
	if ( move >= LS_H1_T_ && move <= LS_H1_BL ) {
		return qtrue;
	}
	if ( move >= LS_V1_BR && move <= LS_V1_B_ ) {
		return qtrue;
	}
	return qfalse;
}

static unsigned char JKA_MoveState( int num, int now )
{
	if ( num < 0 || num >= MAX_CLIENTS ) {
		return JKA_STATE_GROUND;
	}
	if ( !jka_slotGrounded[num] ) {
		return JKA_STATE_AIR;
	}
	if ( jka_slotLandedAt[num] > 0 && now - jka_slotLandedAt[num] <= JKA_LAND_WINDOW ) {
		return JKA_STATE_LAND;
	}
	return JKA_STATE_GROUND;
}

// groundEntityNum is ENTITYNUM_NONE while airborne; the transition back to a
// ground entity starts the short "just landed" window.
static void JKA_TrackGroundState( int num, int now, int groundEntityNum, qboolean dead )
{
	qboolean grounded;

	if ( num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( dead ) {
		jka_slotGrounded[num] = qtrue;
		jka_slotLandedAt[num] = 0;
		return;
	}
	grounded = ( groundEntityNum != ENTITYNUM_NONE ) ? qtrue : qfalse;
	if ( grounded && !jka_slotGrounded[num] ) {
		jka_slotLandedAt[num] = now;
	}
	jka_slotGrounded[num] = grounded;
}

static void JKA_TrackBlockState( int now, int num, int move, qboolean dead )
{
	jkaGame_t *game = JKA_CurrentGame();
	int winner = -1;
	int kind = 0;

	if ( !game || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( dead || !JKA_SaberMoveIsBrokenParry( move ) ) {
		jka_slotBroken[num] = qfalse;
		return;
	}
	if ( jka_slotBroken[num] ) {
		return;
	}
	jka_slotBroken[num] = qtrue;

	if ( move >= LS_H1_T_ && move <= LS_H1_BL ) {
		// The defender's parry was broken by the last player who hit them.
		kind = 1;
		if ( jka_slotLastHitTime[num] >= 0 && now - jka_slotLastHitTime[num] <= JKA_BLOCK_WINDOW ) {
			winner = jka_slotLastHitAttacker[num];
		}
	} else {
		// The loser's own strike was knocked away; the target they last hit
		// is the defender who knocked it away.
		kind = 2;
		if ( jka_slotLastHitByTime[num] >= 0 && now - jka_slotLastHitByTime[num] <= JKA_BLOCK_WINDOW ) {
			winner = jka_slotLastHitByTarget[num];
		}
	}

	// A wall bounce or a lost saber-lock clash also plays a broken animation
	// but has no recent saber contact with the other player.
	if ( winner < 0 || winner >= MAX_CLIENTS || winner == num ) {
		return;
	}
	if ( game->blockCount >= JKA_MAX_BLOCKS ) {
		game->blockOverflow = qtrue;
		return;
	}
	{
		jkaBlock_t *block = &game->blocks[game->blockCount++];
		block->time = now;
		block->winner = (short)winner;
		block->loser = (short)num;
		block->kind = (unsigned char)kind;
	}
}

static void JKA_TrackPlayerSwing( int now, entityState_t *state )
{
	jkaGame_t *game = JKA_CurrentGame();
	int num = state->number;
	int stance;

	if ( !game || state->eType != ET_PLAYER || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	// The recorded client's own entity is not in the demo snapshots; its
	// playerState path (JKA_TrackSelfSwing) owns slot clientNum.
	if ( num == cl.snap.ps.clientNum ) {
		return;
	}
	stance = jka_slotStance[num];
	JKA_TrackSwingState( game, now, num, state->saberMove, stance, jka_slotSaber[num],
		state->torsoFlip, state->saberInFlight, ( state->eFlags & EF_DEAD ) ? qtrue : qfalse );
}

// The recorded client does receive its own playerState, which carries the
// exact saber style and the resolved saberMove.  Track the POV's swings from
// there so the demo's most interesting player is not left without data.
static void JKA_TrackSelfSwing( int now )
{
	jkaGame_t *game = JKA_CurrentGame();
	int num = cl.snap.ps.clientNum;
	int move;

	if ( !game || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	move = cl.snap.ps.weapon == WP_SABER ? cl.snap.ps.saberMove : LS_NONE;
	JKA_TrackSwingState( game, now, num, move, cl.snap.ps.fd.saberAnimLevel, jka_slotSaber[num],
		cl.snap.ps.torsoFlip, cl.snap.ps.saberInFlight,
		cl.snap.ps.stats[STAT_HEALTH] > 0 ? qfalse : qtrue );
	JKA_TrackBlockState( now, num, move, cl.snap.ps.stats[STAT_HEALTH] > 0 ? qfalse : qtrue );
}

static void JKA_TrackSelfGround( int now )
{
	JKA_TrackGroundState( cl.snap.ps.clientNum, now, cl.snap.ps.groundEntityNum,
		cl.snap.ps.stats[STAT_HEALTH] > 0 ? qfalse : qtrue );
}

static void JKA_TrackStanceState( jkaGame_t *game, int now, int num, int stance )
{
	if ( !game || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( JKA_IsSpectator( num ) ) {
		return;
	}
	if ( jka_slotStance[num] == stance ) {
		return;
	}
	jka_slotStance[num] = stance;
	JKA_EnsureRecord( game, num, now );
	JKA_EmitStance( game, now, num, stance );
}

static void JKA_TrackPlayerStance( int now, entityState_t *state )
{
	jkaGame_t *game = JKA_CurrentGame();
	int num = state->number;
	int stance;

	if ( !game || state->eType != ET_PLAYER || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( num == cl.snap.ps.clientNum ) {
		return;
	}
	// A dual/staff player with one blade/saber off falls back to a single
	// style (SS_FAST, or the hilt's singleBladeStyle), so only apply the
	// clientinfo correction while both are on.  This mirrors cgame patch 0012.
	stance = state->fireflag;
	if ( state->saberHolstered == 0 ) {
		stance = JKA_SaberStance( game, jka_slotSaber[num], stance );
	}
	JKA_TrackStanceState( game, now, num, stance );
}

static void JKA_TrackSelfStance( int now )
{
	JKA_TrackStanceState( JKA_CurrentGame(), now, cl.snap.ps.clientNum,
		cl.snap.ps.weapon == WP_SABER ? cl.snap.ps.fd.saberAnimLevel : 0 );
}

static void JKA_ClearPendingHits( int target )
{
	if ( target >= 0 && target < MAX_CLIENTS ) {
		jka_pendingHitCount[target] = 0;
	}
}

static int JKA_NewestPendingSwing( int target, int attacker )
{
	int i;

	if ( target < 0 || target >= MAX_CLIENTS ) {
		return 0;
	}
	for ( i = jka_pendingHitCount[target] - 1; i >= 0; i-- ) {
		if ( jka_pendingHits[target][i].attacker == attacker ) {
			return jka_pendingHits[target][i].swing;
		}
	}
	return 0;
}

// A player outside the recorded client's PVS has no entity states, so their
// last swing index can be stale.  Never attribute a hit or a health loss to a
// swing older than the pending-hit window.
static qboolean JKA_SwingRecent( jkaGame_t *game, int swing, int now )
{
	if ( !game || swing <= 0 || swing > game->swingCount ) {
		return qfalse;
	}
	return ( now - game->swings[swing - 1].time <= 2000 ) ? qtrue : qfalse;
}

static void JKA_EmitDamage( jkaGame_t *game, int now, int target, int attacker, int damage, int source, int swing )
{
	jkaDamage_t *sample;

	if ( !game || target < 0 || target >= MAX_CLIENTS || damage <= 0 ) {
		return;
	}
	if ( damage > 9999 ) {
		damage = 9999;
	}
	if ( game->damageCount >= JKA_MAX_DAMAGES ) {
		game->damageOverflow = qtrue;
		return;
	}
	sample = &game->damages[game->damageCount++];
	sample->time = now;
	sample->target = (short)target;
	sample->attacker = (short)attacker;
	sample->damage = (short)damage;
	sample->source = (unsigned char)source;
	sample->friendly = (unsigned char)JKA_SameTeam( game, attacker, target );
	jka_lastDamageIndex[target] = game->damageCount - 1;

	// Attach the loss to the swing whose hit caused it, so per-swing damage
	// (mean/median) comes from the demo rather than from an even split.
	if ( JKA_SwingRecent( game, swing, now ) ) {
		jkaSwing_t *hit = &game->swings[swing - 1];
		if ( attacker >= 0 && hit->num == attacker ) {
			hit->damage = (short)( hit->damage + damage );
		}
	}
}

static void JKA_AddPendingHit( int now, int target, int attacker, int source )
{
	jkaGame_t *game = JKA_CurrentGame();
	int count;
	int write;
	int i;
	int swing = 0;

	if ( target < 0 || target >= MAX_CLIENTS || attacker < 0 || attacker >= MAX_CLIENTS ||
		target == attacker ) {
		return;
	}
	if ( attacker < MAX_CLIENTS ) {
		swing = jka_slotSwing[attacker];
		if ( !JKA_SwingRecent( game, swing, now ) ) {
			swing = 0;
		}
	}
	count = jka_pendingHitCount[target];
	write = 0;
	for ( i = 0; i < count; i++ ) {
		if ( now - jka_pendingHits[target][i].time <= 2000 ) {
			jka_pendingHits[target][write++] = jka_pendingHits[target][i];
		}
	}
	count = write;
	if ( count >= JKA_MAX_PENDING_HITS ) {
		for ( i = 1; i < count; i++ ) {
			jka_pendingHits[target][i - 1] = jka_pendingHits[target][i];
		}
		count = JKA_MAX_PENDING_HITS - 1;
	}
	jka_pendingHits[target][count].time = now;
	jka_pendingHits[target][count].attacker = (short)attacker;
	jka_pendingHits[target][count].swing = (short)swing;
	jka_pendingHits[target][count].source = (unsigned char)source;
	jka_pendingHitCount[target] = count + 1;

	// A saber contact is recorded even when the demo never exposes the
	// target's health: it drives the air/ground stats and the guard-break
	// pairing.
	if ( source == JKA_DAMAGE_SABER && game ) {
		jka_slotLastHitTime[target] = now;
		jka_slotLastHitAttacker[target] = attacker;
		jka_slotLastHitByTime[attacker] = now;
		jka_slotLastHitByTarget[attacker] = target;
		if ( game->saberHitCount < JKA_MAX_SABER_HITS ) {
			jkaSaberHit_t *saberHit = &game->saberHits[game->saberHitCount++];
			saberHit->time = now;
			saberHit->attacker = (short)attacker;
			saberHit->target = (short)target;
			saberHit->attackerState = JKA_MoveState( attacker, now );
			saberHit->targetState = JKA_MoveState( target, now );
		} else {
			game->saberHitOverflow = qtrue;
		}
	}

	// The hit itself is exact even when the demo never exposes the target's
	// health, so count it on the swing right away.
	if ( source == JKA_DAMAGE_SABER && game && JKA_SwingRecent( game, swing, now ) ) {
		jkaSwing_t *hit = &game->swings[swing - 1];
		if ( hit->num == attacker && hit->hits < 255 ) {
			hit->hits++;
		}
	}
}

// Records one observed health/armor loss.  The POV's own incoming damage is
// attributed exactly with PERS_ATTACKER; other targets use the saber/missile
// hit events and POV hit counter collected for this snapshot.  When several
// attackers are pending the loss is split by their hit counts, and when nobody
// is pending it is kept as unknown.
static void JKA_RecordDamage( jkaGame_t *game, int now, int target, int damage )
{
	int counts[MAX_CLIENTS];
	int sources[MAX_CLIENTS];
	int i;
	int count;
	int total = 0;
	int remaining;
	int lastAttacker = -1;

	if ( !game || damage <= 0 || target < 0 || target >= MAX_CLIENTS ) {
		return;
	}

	if ( target == cl.snap.ps.clientNum ) {
		int attacker = cl.snap.ps.persistant[PERS_ATTACKER];
		if ( attacker < 0 || attacker >= MAX_CLIENTS || attacker == target ) {
			attacker = -1;
		}
		JKA_EmitDamage( game, now, target, attacker, damage,
			attacker >= 0 ? JKA_DAMAGE_POV_IN : JKA_DAMAGE_UNKNOWN,
			attacker >= 0 ? JKA_NewestPendingSwing( target, attacker ) : 0 );
		JKA_ClearPendingHits( target );
		return;
	}

	Com_Memset( counts, 0, sizeof( counts ) );
	Com_Memset( sources, 0, sizeof( sources ) );
	count = jka_pendingHitCount[target];
	for ( i = 0; i < count; i++ ) {
		int attacker;
		if ( now - jka_pendingHits[target][i].time > 2000 ) {
			continue;
		}
		attacker = jka_pendingHits[target][i].attacker;
		if ( attacker < 0 || attacker >= MAX_CLIENTS ) {
			continue;
		}
		if ( !counts[attacker] ) {
			sources[attacker] = jka_pendingHits[target][i].source;
		}
		counts[attacker]++;
		total++;
	}

	if ( !total ) {
		JKA_EmitDamage( game, now, target, -1, damage, JKA_DAMAGE_UNKNOWN, 0 );
		JKA_ClearPendingHits( target );
		return;
	}

	for ( i = 0; i < MAX_CLIENTS; i++ ) {
		if ( counts[i] ) {
			lastAttacker = i;
		}
	}
	remaining = damage;
	for ( i = 0; i < MAX_CLIENTS; i++ ) {
		int share;
		if ( !counts[i] ) {
			continue;
		}
		if ( i == lastAttacker ) {
			share = remaining;
		} else {
			share = (int)( (long long)damage * counts[i] / total );
			if ( share > remaining ) {
				share = remaining;
			}
		}
		remaining -= share;
		JKA_EmitDamage( game, now, target, i, share, sources[i], JKA_NewestPendingSwing( target, i ) );
	}
	JKA_ClearPendingHits( target );
}

// The POV's playerState carries PERS_HITS (a hit counter) and
// PERS_ATTACKEE_ARMOR (the target's health/armor before the hit).  Match that
// state against the tracked vitals to identify whom the recorded player hit;
// this is the only attribution available for hitscan weapons.
static void JKA_TrackPovDamage( int now )
{
	int povNum = cl.snap.ps.clientNum;
	int hits = cl.snap.ps.persistant[PERS_HITS];
	int extra;
	int packed;
	int preHealth;
	int preArmor;
	int candidates = 0;
	int target = -1;
	int i;

	if ( povNum < 0 || povNum >= MAX_CLIENTS || JKA_IsSpectator( povNum ) ) {
		jka_lastPovHits = hits;
		return;
	}
	if ( jka_lastPovHits < 0 ) {
		jka_lastPovHits = hits;
		return;
	}
	if ( hits <= jka_lastPovHits ) {
		jka_lastPovHits = hits;
		return;
	}
	extra = hits - jka_lastPovHits;
	jka_lastPovHits = hits;

	packed = cl.snap.ps.persistant[PERS_ATTACKEE_ARMOR];
	preHealth = packed >> 8;
	preArmor = packed & 0xff;
	for ( i = 0; i < MAX_CLIENTS; i++ ) {
		if ( i == povNum || !jka_slotKnown[i] || jka_slotDead[i] ||
			JKA_IsSpectator( i ) ) {
			continue;
		}
		if ( jka_slotHealth[i] == preHealth && jka_slotArmor[i] == preArmor ) {
			candidates++;
			target = i;
		}
	}
	if ( candidates == 1 ) {
		for ( i = 0; i < extra && i < 8; i++ ) {
			JKA_AddPendingHit( now, target, povNum, JKA_DAMAGE_POV_OUT );
		}
	}
}

// Applies one observed/derived vitals value for a client.  Positive health
// after a tracked death starts a new life; EV_PAIN and duel samples carry no
// armor, so a health drop is taken as "the armor was used up" (base JKA armor
// absorbs all damage until it is empty).
static void JKA_SetVitals( int now, int num, int health, int armor, int source )
{
	jkaGame_t *game = JKA_CurrentGame();
	int oldHealth;
	int oldArmor;
	int lost = 0;
	qboolean wasKnown;
	qboolean respawned = qfalse;

	if ( !game || num < 0 || num >= MAX_CLIENTS || JKA_IsSpectator( num ) ) {
		return;
	}
	JKA_EnsureRecord( game, num, now );

	oldHealth = jka_slotHealth[num];
	oldArmor = jka_slotArmor[num];
	wasKnown = jka_slotKnown[num];

	if ( health <= 0 ) {
		if ( wasKnown ) {
			if ( oldHealth > 0 ) {
				lost += oldHealth;
			}
			if ( oldArmor > 0 ) {
				lost += oldArmor;
			}
		}
		jka_slotHealth[num] = 0;
		jka_slotArmor[num] = 0;
		jka_slotDead[num] = qtrue;
		jka_slotKnown[num] = qtrue;
		if ( lost > 0 ) {
			JKA_RecordDamage( game, now, num, lost );
		} else {
			JKA_ClearPendingHits( num );
		}
		if ( oldHealth != 0 || oldArmor != 0 ) {
			JKA_EmitVitals( game, now, num, 0, 0, JKA_VITALS_DEATH );
		}
		return;
	}

	if ( jka_slotDead[num] ) {
		jka_slotDead[num] = qfalse;
		respawned = qtrue;
		if ( armor < 0 ) {
			armor = 25;
		}
		JKA_ClearPendingHits( num );
	} else if ( armor < 0 ) {
		armor = ( health < oldHealth ) ? 0 : oldArmor;
	}

	// Only count a loss once this slot has a real observation; the 100/25
	// spawn state is a fallback and would invent damage on a demo that starts
	// mid-game.  Health and armor above max decay by one point per second with
	// no attacker, so a single-point drop above 100 is not damage.
	if ( wasKnown && !respawned ) {
		if ( oldHealth > 100 && health == oldHealth - 1 ) {
			// over-max health decay
		} else if ( health < oldHealth ) {
			lost += oldHealth - health;
		}
		if ( oldArmor > 100 && armor == oldArmor - 1 ) {
			// over-max armor decay
		} else if ( armor >= 0 && armor < oldArmor ) {
			lost += oldArmor - armor;
		}
	}

	jka_slotHealth[num] = health;
	jka_slotArmor[num] = armor;
	jka_slotKnown[num] = qtrue;

	if ( lost > 0 ) {
		JKA_RecordDamage( game, now, num, lost );
	}

	if ( respawned || health != oldHealth || armor != oldArmor ) {
		JKA_EmitVitals( game, now, num, health, armor, source );
	}
}

static void JKA_SpawnSlot( int now, int slot )
{
	jkaGame_t *game = JKA_CurrentGame();

	JKA_ResetSlotVitals( slot );
	if ( game ) {
		JKA_EmitVitals( game, now, slot, 100, 25, JKA_VITALS_SPAWN );
	}
}

static void JKA_UpdatePlayers( int now )
{
	jkaGame_t *game = JKA_CurrentGame();
	int slot;

	if ( !game ) {
		return;
	}

	for ( slot = 0; slot < MAX_CLIENTS; slot++ ) {
		const char *info = JKA_ConfigString( CS_PLAYERS + slot );
		unsigned int hash = JKA_HashString( info );
		jkaPlayerRecord_t *record;
		char name[64];
		char *value;
		int team;

		if ( hash == jka_slotHash[slot] ) {
			continue;
		}
		jka_slotHash[slot] = hash;

		if ( !info[0] ) {
			JKA_CloseSlot( game, slot, now );
			continue;
		}

		Q_strncpyz( name, Info_ValueForKey( info, "n" ), sizeof( name ) );
		if ( !name[0] ) {
			JKA_CloseSlot( game, slot, now );
			continue;
		}
		// The clientinfo saber name identifies the saber and recovers the
		// stance that the two-bit fireflag truncates (dual/staff).
		jka_slotSaber[slot] = JKA_SaberId( game, Info_ValueForKey( info, "st" ) );
		value = Info_ValueForKey( info, "t" );
		team = value && value[0] ? atoi( value ) : 0;

		record = JKA_ActiveRecord( game, slot );
		if ( record && record->placeholder ) {
			Q_strncpyz( record->name, name, sizeof( record->name ) );
			record->placeholder = qfalse;
			record->team = team;
			record->lastSeen = now;
			continue;
		}
		if ( record && Q_stricmp( record->name, name ) ) {
			JKA_CloseSlot( game, slot, now );
			record = NULL;
		}
		if ( record ) {
			record->team = team;
			record->lastSeen = now;
			continue;
		}

		record = JKA_FindClosedRecord( game, name );
		if ( record ) {
			record->num = slot;
			record->active = qtrue;
			record->left = qfalse;
			record->returned = qtrue;
			record->leftAt = 0;
			record->lastSeen = now;
			record->team = team;
			jka_slotRecord[slot] = (int)( record - game->players );
			JKA_SpawnSlot( now, slot );
		} else {
			record = JKA_AddRecord( game, slot, name, team, now, qfalse );
			if ( record ) {
				jka_slotRecord[slot] = game->playerCount - 1;
				JKA_SpawnSlot( now, slot );
			}
		}
	}
}

static void JKA_StartGame( int now, int gamestateId )
{
	jkaGame_t *game;
	const char *mapname;

	if ( jka_gameCount >= JKA_MAX_GAMES ) {
		return;
	}

	game = &jka_games[jka_gameCount++];
	Com_Memset( game, 0, sizeof( *game ) );
	game->gamestateId = gamestateId;
	game->startTime = now;
	game->endTime = now;
	game->levelStartTime = atoi( JKA_ConfigString( CS_LEVEL_START_TIME ) );
	game->observedLevelStartTime = game->levelStartTime;
	mapname = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
	Q_strncpyz( game->map, mapname && mapname[0] ? mapname : "unknown", sizeof( game->map ) );
	Com_Memcpy( game->baselines, cl.entityBaselines, sizeof( game->baselines ) );
	game->hasBaselines = qtrue;
	game->saberCount = 1;
	Q_strncpyz( game->sabers[0].name, "unknown", sizeof( game->sabers[0].name ) );
	game->pov = ( clc.clientNum >= 0 && clc.clientNum < MAX_CLIENTS ) ? clc.clientNum : -1;

	jka_currentGame = jka_gameCount - 1;
	for ( int i = 0; i < MAX_CLIENTS; i++ ) {
		jka_slotRecord[i] = -1;
		jka_slotHash[i] = 0;
		jka_slotSaber[i] = 0;
		JKA_ResetSlotVitals( i );
	}
	jka_lastSnapMessageNum = -1;
	jka_lastEventTime = -1;
	jka_lastEventTarget = -1;
	jka_lastEventAttacker = -1;
	jka_lastEventMod = -1;
	Com_Memset( jka_eventEntitySeen, 0, sizeof( jka_eventEntitySeen ) );
	Com_Memset( jka_eventEntityValue, 0, sizeof( jka_eventEntityValue ) );
	Com_Memset( jka_predictablePain, 0, sizeof( jka_predictablePain ) );
	Com_Memset( jka_missileEventValue, 0, sizeof( jka_missileEventValue ) );
	Com_Memset( jka_pendingHitCount, 0, sizeof( jka_pendingHitCount ) );
	jka_lastPovHits = -1;
	JKA_ResetScriptTracks();

	JKA_UpdatePlayers( now );
}

static void JKA_TrackObituary( int now, int target, int attacker, int mod )
{
	jkaGame_t *game = JKA_CurrentGame();
	jkaPlayerRecord_t *record;

	if ( !game || target < 0 || target >= MAX_CLIENTS ) {
		return;
	}
	if ( jka_lastEventTime >= 0 && now - jka_lastEventTime <= 100 &&
		jka_lastEventTarget == target && jka_lastEventAttacker == attacker &&
		jka_lastEventMod == mod ) {
		return;
	}
	jka_lastEventTime = now;
	jka_lastEventTarget = target;
	jka_lastEventAttacker = attacker;
	jka_lastEventMod = mod;

	if ( game->eventCount < JKA_MAX_EVENTS ) {
		jkaEvent_t *event = &game->events[game->eventCount++];
		event->time = now;
		event->target = target;
		event->attacker = attacker;
		event->mod = mod;
		event->friendly = (unsigned char)JKA_SameTeam( game, attacker, target );
	} else {
		game->eventOverflow = qtrue;
	}

	JKA_EnsureRecord( game, target, now );
	record = JKA_ActiveRecord( game, target );
	if ( record ) {
		record->deaths++;
		record->lastSeen = now;
	}
	// The killing blow is the last attribution we can add without a damage log.
	JKA_AddPendingHit( now, target, attacker, JKA_DAMAGE_KILL );
	JKA_SetVitals( now, target, 0, 0, JKA_VITALS_DEATH );

	// If the fatal health loss was recorded before this obituary and stayed
	// unattributed, credit the killer now.
	if ( attacker >= 0 && attacker < MAX_CLIENTS && attacker != target ) {
		int index = jka_lastDamageIndex[target];
		if ( index >= 0 && index < game->damageCount ) {
			jkaDamage_t *damage = &game->damages[index];
			if ( damage->attacker < 0 && now - damage->time <= 1500 ) {
				damage->attacker = (short)attacker;
				damage->source = JKA_DAMAGE_KILL;
				damage->friendly = (unsigned char)JKA_SameTeam( game, attacker, target );
			}
		}
	}

	if ( attacker >= 0 && attacker < MAX_CLIENTS && attacker != target ) {
		JKA_EnsureRecord( game, attacker, now );
		record = JKA_ActiveRecord( game, attacker );
		if ( record ) {
			record->kills++;
			record->lastSeen = now;
		}
	}
}

// A freestanding temp entity can stay in several snapshots.  Mirror cgame's
// per-entity previousEvent with the previous-snapshot check so one event is
// counted once.
static qboolean JKA_TempEventSeen( entityState_t *state, int event )
{
	if ( state->number < 0 || state->number >= MAX_GENTITIES ) {
		return qfalse;
	}
	if ( jka_eventEntitySeen[state->number] == jka_snapshotSerial - 1 &&
		jka_eventEntityValue[state->number] == event ) {
		jka_eventEntitySeen[state->number] = jka_snapshotSerial;
		return qtrue;
	}
	jka_eventEntitySeen[state->number] = jka_snapshotSerial;
	jka_eventEntityValue[state->number] = event;
	return qfalse;
}

static const char *JKA_ParseIntToken( const char *s, int *out )
{
	int value = 0;
	qboolean negative = qfalse;
	qboolean any = qfalse;

	while ( *s == ' ' || *s == '\t' ) {
		s++;
	}
	if ( *s == '-' ) {
		negative = qtrue;
		s++;
	}
	while ( *s >= '0' && *s <= '9' ) {
		value = value * 10 + ( *s - '0' );
		s++;
		any = qtrue;
	}
	if ( !any ) {
		return NULL;
	}
	*out = negative ? -value : value;
	return s;
}

// "tinfo <count> <client> <location> <health> <armor> <weapon> <powerups> ..."
// is the team overlay the server sends to a playing client.  It is the only
// exact remote health/armor the demo carries for teammates.
static void JKA_ParseTeamInfo( const char *command, int now )
{
	const char *s = command;
	int count;
	int i;

	while ( *s && *s != ' ' && *s != '\t' ) {
		s++;
	}
	if ( !( s = JKA_ParseIntToken( s, &count ) ) || count <= 0 || count > MAX_CLIENTS ) {
		return;
	}
	for ( i = 0; i < count; i++ ) {
		int num;
		int scratch;
		int health;
		int armor;

		if ( !( s = JKA_ParseIntToken( s, &num ) ) ) {
			return;
		}
		if ( !( s = JKA_ParseIntToken( s, &scratch ) ) ) {	// location
			return;
		}
		if ( !( s = JKA_ParseIntToken( s, &health ) ) ) {
			return;
		}
		if ( !( s = JKA_ParseIntToken( s, &armor ) ) ) {
			return;
		}
		if ( !( s = JKA_ParseIntToken( s, &scratch ) ) ) {	// weapon
			return;
		}
		if ( !( s = JKA_ParseIntToken( s, &scratch ) ) ) {	// powerups
			return;
		}
		JKA_SetVitals( now, num, health, armor, JKA_VITALS_TEAMINFO );
	}
}

static int JKA_NextPipeInt( const char **cursor, qboolean *ok )
{
	const char *s = *cursor;
	int value = 0;
	qboolean negative = qfalse;
	qboolean any = qfalse;

	if ( !s ) {
		*ok = qfalse;
		return 0;
	}
	while ( *s == ' ' || *s == '\t' ) {
		s++;
	}
	if ( *s == '!' ) {
		*ok = qfalse;
		return 0;
	}
	if ( *s == '-' ) {
		negative = qtrue;
		s++;
	}
	while ( *s >= '0' && *s <= '9' ) {
		value = value * 10 + ( *s - '0' );
		s++;
		any = qtrue;
	}
	if ( !any ) {
		*ok = qfalse;
		return 0;
	}
	while ( *s && *s != '|' ) {
		s++;
	}
	if ( *s == '|' ) {
		s++;
	}
	*cursor = s;
	*ok = qtrue;
	return negative ? -value : value;
}

// CS_CLIENT_DUELHEALTHS is "<h1>|<h2>|<h3>" matching CS_CLIENT_DUELISTS.
// Duels transmit exact health but not armor.
static void JKA_TrackDuelHealth( int now )
{
	const char *list = JKA_ConfigString( CS_CLIENT_DUELISTS );
	const char *healths = JKA_ConfigString( CS_CLIENT_DUELHEALTHS );
	int num[3] = { -1, -1, -1 };
	int health[3] = { -1, -1, -1 };
	qboolean ok = qtrue;
	int i;

	if ( !list[0] || !healths[0] ) {
		return;
	}
	for ( i = 0; i < 3; i++ ) {
		num[i] = JKA_NextPipeInt( &list, &ok );
		if ( !ok ) {
			break;
		}
	}
	ok = qtrue;
	for ( i = 0; i < 3; i++ ) {
		health[i] = JKA_NextPipeInt( &healths, &ok );
		if ( !ok ) {
			break;
		}
	}
	for ( i = 0; i < 3; i++ ) {
		if ( num[i] >= 0 && num[i] < MAX_CLIENTS && health[i] > 0 ) {
			JKA_SetVitals( now, num[i], health[i], -1, JKA_VITALS_DUEL );
		}
	}
}

// Client entities carry EF_DEAD and, when the server mirrors a playerState
// event, EV_PAIN in entityState.event.  Its eventParm is the health left.
static void JKA_TrackPlayerVitals( int now, entityState_t *state )
{
	int num = state->number;
	qboolean dead;

	if ( state->eType != ET_PLAYER || num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( JKA_IsSpectator( num ) ) {
		return;
	}
	JKA_TrackPlayerStance( now, state );
	JKA_TrackPlayerSwing( now, state );
	dead = ( state->eFlags & EF_DEAD ) ? qtrue : qfalse;
	JKA_TrackBlockState( now, num, state->saberMove, dead );
	if ( dead ) {
		if ( !jka_slotDead[num] ) {
			JKA_SetVitals( now, num, 0, 0, JKA_VITALS_DEATH );
		}
	} else if ( jka_slotDead[num] ) {
		// A respawn: back to the spawn defaults until a sample says otherwise.
		JKA_SpawnSlot( now, num );
	}

	if ( state->event && state->event != jka_entityEventValue[num] ) {
		jka_entityEventValue[num] = state->event;
		// Predictable saber pain events carry a 1..100 sound bucket, not the
		// health left.  The server also broadcasts them as EF_PLAYER_EVENT
		// temp entities; JKA_ProcessSnapshot marks those slots for this
		// snapshot.  The recorded client is covered by its exact playerState.
		if ( ( state->event & ~EV_EVENT_BITS ) == EV_PAIN &&
			!jka_predictablePain[num] && num != cl.snap.ps.clientNum ) {
			JKA_SetVitals( now, num, state->eventParm, -1, JKA_VITALS_PAIN );
		}
	}
}

static void JKA_TrackSelfVitals( int now )
{
	int num = cl.snap.ps.clientNum;
	int health;
	int armor;

	if ( num < 0 || num >= MAX_CLIENTS || JKA_IsSpectator( num ) ) {
		return;
	}
	health = cl.snap.ps.stats[STAT_HEALTH];
	armor = cl.snap.ps.stats[STAT_ARMOR];
	if ( armor < 0 ) {
		armor = 0;
	}
	JKA_SetVitals( now, num, health > 0 ? health : 0, health > 0 ? armor : 0, JKA_VITALS_SELF );
}

static jkaScriptTrack_t	jka_scriptTracks[MAX_CLIENTS];
static int				jka_scriptPovClient = -1;

static int JKA_AngleShort( float degrees )
{
	return ( (int)( degrees * ( 65536.0f / 360.0f ) ) ) & 0xFFFF;
}

/// Signed shortest-path difference of two `ANGLE2SHORT` angles.
static int JKA_AngleDelta( int now, int before )
{
	return (int)(short)( ( now - before ) & 0xFFFF );
}

static void JKA_ResetScriptTracks( void )
{
	Com_Memset( jka_scriptTracks, 0, sizeof( jka_scriptTracks ) );
	jka_scriptPovClient = -1;
}

static void JKA_ScriptFlag( jkaGame_t *game, jkaScriptRun_t *run, int now, int num,
	int channel, int meanMs, int stepPercent, int swing )
{
	jkaScriptFlag_t *flag;
	int confidence;
	int i;

	confidence = ( run->runCount >= JKA_SCRIPT_STRONG_REVERSALS &&
		meanMs <= JKA_SCRIPT_STRONG_MEAN_MS && stepPercent >= JKA_SCRIPT_STRONG_PERCENT &&
		swing >= JKA_SCRIPT_STRONG_SWING ) ? 1 : 0;

	// Merge with the previous finding of the same player/channel when it is
	// the same run or the next press of the same bind.
	for ( i = game->scriptCount - 1; i >= 0; i-- ) {
		flag = &game->scripts[i];
		if ( flag->num != num || flag->channel != channel ) {
			continue;
		}
		if ( run->runFirstTime > flag->endTime + JKA_SCRIPT_MERGE_MS ) {
			break;
		}
		flag->endTime = now;
		if ( run->runFirstTime != flag->time && flag->bursts < 255 ) {
			// A new press of the same bind, not another reversal of one run.
			flag->bursts++;
		}
		if ( run->runCount > flag->reversals ) {
			flag->reversals = (unsigned char)( run->runCount > 255 ? 255 : run->runCount );
		}
		flag->meanMs = (short)meanMs;
		flag->swing = (short)( swing * 10 / 182 );
		flag->stepPercent = (unsigned char)stepPercent;
		flag->samples = (unsigned char)( run->stepCount > 255 ? 255 : run->stepCount );
		if ( confidence > flag->confidence ) {
			flag->confidence = (unsigned char)confidence;
		}
		return;
	}

	if ( game->scriptCount >= JKA_SCRIPT_MAX_FLAGS ) {
		game->scriptOverflow = qtrue;
		return;
	}
	flag = &game->scripts[game->scriptCount++];
	Com_Memset( flag, 0, sizeof( *flag ) );
	flag->time = run->runFirstTime;
	flag->endTime = now;
	flag->num = (short)num;
	flag->channel = (unsigned char)channel;
	flag->reversals = (unsigned char)( run->runCount > 255 ? 255 : run->runCount );
	flag->bursts = 1;
	flag->confidence = (unsigned char)confidence;
	flag->meanMs = (short)meanMs;
	// `ANGLE2SHORT` units to tenths of a degree (65536 units = 360°).
	flag->swing = (short)( swing * 10 / 182 );
	flag->stepPercent = (unsigned char)stepPercent;
	flag->samples = (unsigned char)( run->stepCount > 255 ? 255 : run->stepCount );
}

/// Feed one view sample for one channel.  Mirrors `ChannelState::observe` in
/// the proxy: reversals only, chained into runs, with the rate, shape and
/// swing verdicts.
static void JKA_ScriptObserve( jkaGame_t *game, jkaScriptTrack_t *track, int now, int num,
	int channel, int delta )
{
	jkaScriptRun_t *run = &track->run[channel];
	int sign;
	int step;
	int holdMs;
	int intervals;
	int meanMs;
	int stepPercent;
	int swing;
	int sustained;
	int wary;
	int verdict;

	if ( delta > 0 ) {
		sign = 1;
	} else if ( delta < 0 ) {
		sign = -1;
		delta = -delta;
	} else {
		sign = 0;
	}
	if ( delta < JKA_SCRIPT_MIN_STEP ) {
		// A partially held turn frame below the noise floor says nothing.
		return;
	}
	step = delta;
	run->unwrapped += sign * step;

	// Every directional sample of a live run feeds the shape measure,
	// including the same-direction ones the reversal logic ignores.
	if ( run->runCount > 0 ) {
		run->stepSum += step;
		run->stepCount++;
		if ( step > run->stepMax ) {
			run->stepMax = step;
		}
	}
	if ( !run->saw ) {
		run->saw = qtrue;
		run->sign = sign;
		return;
	}
	if ( sign == run->sign ) {
		return;
	}

	run->sign = sign;
	holdMs = now - run->flipTime;
	run->flipTime = now;

	if ( run->runCount == 0 || holdMs > JKA_SCRIPT_RUN_GAP_MS ) {
		// A fresh run starts at this reversal; its first hold is measured
		// from the pre-run sample and is not part of the hold range.
		run->runCount = 1;
		run->runFirstTime = now;
		run->stepSum = step;
		run->stepCount = 1;
		run->stepMax = step;
		run->swingMin = run->unwrapped;
		run->swingMax = run->unwrapped;
		return;
	}

	run->runCount++;
	if ( run->unwrapped < run->swingMin ) {
		run->swingMin = run->unwrapped;
	}
	if ( run->unwrapped > run->swingMax ) {
		run->swingMax = run->unwrapped;
	}

	intervals = run->runCount - 1;
	meanMs = ( now - run->runFirstTime ) / intervals;
	stepPercent = run->stepMax > 0
		? (int)( ( (long long)run->stepSum * 100 ) /
			( (long long)run->stepMax * run->stepCount ) )
		: 0;
	swing = run->swingMax - run->swingMin;

	sustained = run->runCount >= JKA_SCRIPT_MIN_REVERSALS && meanMs <= JKA_SCRIPT_MAX_MEAN_MS;
	wary = run->waryUntil > now && run->runCount >= JKA_SCRIPT_WARY_REVERSALS &&
		meanMs <= JKA_SCRIPT_MAX_MEAN_MS;
	verdict = ( sustained || wary ) && stepPercent >= JKA_SCRIPT_STEP_PERCENT &&
		swing >= JKA_SCRIPT_MIN_SWING;
	if ( !verdict ) {
		return;
	}
	run->waryUntil = now + JKA_SCRIPT_WARY_MS;
	JKA_ScriptFlag( game, run, now, num, channel, meanMs, stepPercent, swing );
}

static void JKA_ScriptSample( jkaGame_t *game, int now, int num, int yaw, int pitch )
{
	jkaScriptTrack_t *track = &jka_scriptTracks[num];

	if ( !track->seen || now < track->lastTime ||
		now - track->lastTime > JKA_SCRIPT_STALE_MS ) {
		// New stream, rewind, PVS gap or POV switch: forget every run and
		// seed the baseline with this sample so the first delta is 0.
		Com_Memset( track, 0, sizeof( *track ) );
		track->seen = qtrue;
		track->lastTime = now;
		track->yaw = yaw;
		track->pitch = pitch;
		return;
	}

	JKA_ScriptObserve( game, track, now, num, JKA_SCRIPT_CH_YAW,
		JKA_AngleDelta( yaw, track->yaw ) );
	JKA_ScriptObserve( game, track, now, num, JKA_SCRIPT_CH_PITCH,
		JKA_AngleDelta( pitch, track->pitch ) );

	track->lastTime = now;
	track->yaw = yaw;
	track->pitch = pitch;
}

/// Sample every player's view angle for the snapshot.  The recorded client's
/// own entity is absent from demos, so its angles come from
/// `cl.snap.ps.viewangles`; remote players carry theirs in `apos.trBase`.
static void JKA_TrackScriptInputs( int now )
{
	jkaGame_t *game = JKA_CurrentGame();
	int pov = cl.snap.ps.clientNum;
	int i;

	if ( !game ) {
		return;
	}
	if ( pov != jka_scriptPovClient ) {
		if ( jka_scriptPovClient >= 0 && jka_scriptPovClient < MAX_CLIENTS ) {
			Com_Memset( &jka_scriptTracks[jka_scriptPovClient], 0,
				sizeof( jka_scriptTracks[jka_scriptPovClient] ) );
		}
		jka_scriptPovClient = pov;
	}
	if ( pov >= 0 && pov < MAX_CLIENTS ) {
		JKA_ScriptSample( game, now, pov,
			JKA_AngleShort( cl.snap.ps.viewangles[YAW] ),
			JKA_AngleShort( cl.snap.ps.viewangles[PITCH] ) );
	}

	for ( i = 0; i < cl.snap.numEntities && i < MAX_PARSE_ENTITIES; i++ ) {
		entityState_t *state = &cl.parseEntities[( cl.snap.parseEntitiesNum + i ) &
			( MAX_PARSE_ENTITIES - 1 )];
		int num = state->number;

		if ( state->eType != ET_PLAYER || num < 0 || num >= MAX_CLIENTS || num == pov ) {
			continue;
		}
		// A spectating client's view is not gameplay input.
		if ( JKA_IsSpectator( num ) ) {
			continue;
		}
		JKA_ScriptSample( game, now, num,
			JKA_AngleShort( state->apos.trBase[YAW] ),
			JKA_AngleShort( state->apos.trBase[PITCH] ) );
	}
}

/// Record one position sample for the minimap trails.  The scan calls this for
/// every player the radar JSON would report; playback and seek replays must
/// not append, so only the scan-only pass reaches it.
static void JKA_AddTrajectorySample( int now, int num, float x, float y )
{
	jkaTrajectorySample_t *sample;

	if ( num < 0 || num >= MAX_CLIENTS ) {
		return;
	}
	if ( x != x || y != y ) {
		// A NaN would poison the whole line; the push/interpolation paths can
		// leave one in a demo origin.
		return;
	}
	if ( jka_trajectoryCount >= JKA_MAX_TRAJECTORY_SAMPLES ) {
		jka_trajectoryOverflow = qtrue;
		return;
	}
	sample = &jka_trajectory[jka_trajectoryCount++];
	sample->time = now;
	sample->x = x;
	sample->y = y;
	sample->num = (short)num;
	sample->pad = 0;
}

static void JKA_TrackTrajectory( int now )
{
	int pov;
	int i;

	if ( !jka_scanOnly ) {
		return;
	}
	// ~7 Hz is enough for a five-second trail and keeps the scan buffer small
	// even for a long demo.
	if ( jka_trajectoryLastTime >= 0 && now - jka_trajectoryLastTime < JKA_TRAJECTORY_INTERVAL_MS ) {
		return;
	}
	jka_trajectoryLastTime = now;

	// The recorded client's own entity is absent from demos, so its position
	// comes from the snapshot player state, like the radar JSON.
	pov = cl.snap.ps.clientNum;
	if ( pov >= 0 && pov < MAX_CLIENTS ) {
		JKA_AddTrajectorySample( now, pov, cl.snap.ps.origin[0], cl.snap.ps.origin[1] );
	}

	for ( i = 0; i < cl.snap.numEntities && i < MAX_PARSE_ENTITIES; i++ ) {
		entityState_t *state = &cl.parseEntities[( cl.snap.parseEntitiesNum + i ) &
			( MAX_PARSE_ENTITIES - 1 )];

		if ( state->eType != ET_PLAYER || state->number < 0 || state->number >= MAX_CLIENTS ||
			state->number == pov ) {
			continue;
		}
		JKA_AddTrajectorySample( now, state->number, state->pos.trBase[0], state->pos.trBase[1] );
	}
}

static void JKA_ProcessSnapshot( int now, int resumeOffset )
{
	jkaGame_t *game = JKA_CurrentGame();
	const char *mapname;
	int levelStart;
	int i;
	qboolean started = qfalse;

	mapname = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
	levelStart = atoi( JKA_ConfigString( CS_LEVEL_START_TIME ) );
	if ( !game || jka_demoGamestates > game->gamestateId ||
		( mapname && mapname[0] && Q_stricmp( game->map, mapname ) ) ) {
		JKA_StartGame( now, jka_demoGamestates );
		game = JKA_CurrentGame();
		started = qtrue;
	} else if ( levelStart > 0 && game->observedLevelStartTime > 0 &&
		levelStart != game->observedLevelStartTime ) {
		// A map restart or a new game can reuse the same gamestate in some
		// mods; the level start time is the reliable match boundary.
		qboolean hasStats = game->eventCount > 0 ? qtrue : qfalse;
		for ( i = 0; i < game->playerCount && !hasStats; i++ ) {
			hasStats = ( game->players[i].kills > 0 || game->players[i].deaths > 0 ) ? qtrue : qfalse;
		}
		game->observedLevelStartTime = levelStart;
		if ( hasStats ) {
			jka_levelStartChanges++;
			JKA_StartGame( now, jka_demoGamestates );
			game = JKA_CurrentGame();
			started = qtrue;
		}
		// If the open game has no activity yet, this is the server's delayed
		// level-start update after a map_restart.  Keep the command-time base
		// so the match clock starts at zero instead of the old map clock.
	}
	if ( !game ) {
		return;
	}
	if ( jka_pendingGameReset ) {
		jka_pendingGameReset = qfalse;
		if ( !started ) {
			jka_levelStartChanges++;
			JKA_StartGame( now, jka_demoGamestates );
			game = JKA_CurrentGame();
			if ( !game ) {
				return;
			}
			// The command-driven restart does not always update CS_LEVEL_START_TIME.
			game->levelStartTime = now;
		}
	}
	if ( game->levelStartTime == 0 && levelStart > 0 ) {
		game->levelStartTime = levelStart;
	}

	game->endTime = now;
	JKA_UpdatePlayers( now );
	// The POV hit counter must be matched before any vitals source updates the
	// target this snapshot, otherwise the pre-hit health/armor no longer match.
	JKA_TrackPovDamage( now );
	JKA_TrackSelfVitals( now );
	JKA_TrackSelfStance( now );
	JKA_TrackSelfSwing( now );
	JKA_TrackSelfGround( now );
	JKA_TrackDuelHealth( now );
	JKA_TrackScriptInputs( now );
	JKA_TrackTrajectory( now );

	if ( jka_keyframeCount < JKA_MAX_KEYFRAMES &&
		( jka_keyframeCount == 0 || now - jka_lastKeyframeTime >= 10000 ) ) {
		jkaKeyframe_t *keyframe = &jka_keyframes[jka_keyframeCount];
		int entityCount = cl.snap.numEntities;
		int i;

		if ( entityCount > MAX_SNAPSHOT_ENTITIES ) {
			// A truncated keyframe would restore a broken snapshot.
			jka_lastKeyframeTime = now;
		} else {
			keyframe->snap = cl.snap;
			keyframe->snap.numEntities = entityCount;
			keyframe->snap.parseEntitiesNum = 0;
			keyframe->entityCount = entityCount;
			keyframe->gameState = cl.gameState;
			keyframe->resumeOffset = resumeOffset;
			keyframe->serverCommandSequence = clc.serverCommandSequence;
			keyframe->lastExecutedServerCommand = clc.lastExecutedServerCommand;
			keyframe->clientNum = clc.clientNum;
			keyframe->gameIndex = jka_currentGame;
			keyframe->time = now;
			for ( i = 0; i < entityCount; i++ ) {
				keyframe->entities[i] = cl.parseEntities[( cl.snap.parseEntitiesNum + i ) & ( MAX_PARSE_ENTITIES - 1 )];
			}
			jka_keyframeCount++;
			jka_lastKeyframeTime = now;
		}
	}
	for ( i = 0; i < MAX_CLIENTS; i++ ) {
		jkaPlayerRecord_t *active = JKA_ActiveRecord( game, i );
		if ( active ) {
			active->lastSeen = now;
		}
	}

	jka_totalSnapshots++;
	jka_snapshotSerial++;
	if ( cl.snap.deltaNum == -1 ) {
		jka_fullSnapshots++;
	}

	// Predictable player pain events (saber locks, broken limbs) are broadcast
	// as EF_PLAYER_EVENT temp entities whose eventParm is a sound bucket, not
	// health.  Mark their slots before reading the player entities so the same
	// EV_PAIN in an entityState is not mistaken for the health left.
	Com_Memset( jka_predictablePain, 0, sizeof( jka_predictablePain ) );
	for ( i = 0; i < cl.snap.numEntities && i < MAX_PARSE_ENTITIES; i++ ) {
		entityState_t *state = &cl.parseEntities[( cl.snap.parseEntitiesNum + i ) & ( MAX_PARSE_ENTITIES - 1 )];

		if ( state->eType >= ET_EVENTS &&
			( state->eType - ET_EVENTS ) == EV_PAIN &&
			( state->eFlags & EF_PLAYER_EVENT ) &&
			state->otherEntityNum >= 0 && state->otherEntityNum < MAX_CLIENTS ) {
			jka_predictablePain[state->otherEntityNum] = qtrue;
		}
		// Movement state must be current before the event pass classifies a
		// saber hit as dealt/received in the air, on the ground or just
		// landed.  The recorded client's own entity is absent; its state comes
		// from the playerState (JKA_TrackSelfGround).
		if ( state->eType == ET_PLAYER && state->number >= 0 && state->number < MAX_CLIENTS &&
			state->number != cl.snap.ps.clientNum ) {
			JKA_TrackGroundState( state->number, now, state->groundEntityNum,
				( state->eFlags & EF_DEAD ) ? qtrue : qfalse );
		}
	}

	// Attribution events and obituaries run before the player vitals so a
	// saber/missile hit and the health change it caused land in the same
	// snapshot.  Missile hits ride on the missile entity's own event field.
	for ( i = 0; i < cl.snap.numEntities && i < MAX_PARSE_ENTITIES; i++ ) {
		entityState_t *state = &cl.parseEntities[( cl.snap.parseEntitiesNum + i ) & ( MAX_PARSE_ENTITIES - 1 )];
		int event;

		if ( state->eType < ET_EVENTS ) {
			if ( state->event &&
				( state->event & ~EV_EVENT_BITS ) == EV_MISSILE_HIT &&
				state->number >= 0 && state->number < MAX_GENTITIES &&
				jka_missileEventValue[state->number] != state->event ) {
				jka_missileEventValue[state->number] = state->event;
				JKA_AddPendingHit( now, state->otherEntityNum, state->owner, JKA_DAMAGE_MISSILE );
			}
			continue;
		}
		// Freestanding event entities carry the event in eType, not event.
		event = state->eType - ET_EVENTS;
		if ( event == EV_SABER_HIT ) {
			if ( !JKA_TempEventSeen( state, event ) ) {
				JKA_AddPendingHit( now, state->otherEntityNum, state->otherEntityNum2, JKA_DAMAGE_SABER );
			}
			continue;
		}
		if ( event == EV_PLAYER_TELEPORT_IN ) {
			// Spawn-in effect; only a respawn when the slot is tracked dead
			// (teleport pads fire this for living players).
			if ( state->clientNum >= 0 && state->clientNum < MAX_CLIENTS &&
				jka_slotDead[state->clientNum] ) {
				JKA_SpawnSlot( now, state->clientNum );
			}
			continue;
		}
		if ( event != EV_OBITUARY ) {
			continue;
		}
		if ( !JKA_TempEventSeen( state, event ) ) {
			JKA_TrackObituary( now, state->otherEntityNum, state->otherEntityNum2, state->eventParm );
		}
	}

	// The recorded player's hit counter identifies hitscan targets.  This has
	// already been read at the top of the snapshot; keep the event pass here
	// only for the damage-attribution events.

	for ( i = 0; i < cl.snap.numEntities && i < MAX_PARSE_ENTITIES; i++ ) {
		entityState_t *state = &cl.parseEntities[( cl.snap.parseEntitiesNum + i ) & ( MAX_PARSE_ENTITIES - 1 )];

		if ( state->eType < ET_EVENTS ) {
			// Events riding on a player entity (EV_PAIN carries the health
			// left in eventParm) and the dead/alive transition.
			JKA_TrackPlayerVitals( now, state );
		}
	}
}

// Scan demo messages without handing EOF to CL_DemoCompleted (which would
// throw through the browser bridge). Returns the last serverTime.
static int JKA_ScanDemo( const char *name, int targetTime, qboolean stopAtTarget,
	int *firstTime, int *lastTime )
{
	char path[256];
	fileHandle_t file = 0;
	byte body[MAX_MSGLEN];
	msg_t msg;
	int length;
	int sequence;
	int messageLength;
	int first = 0;
	int last = 0;
	int count = 0;
	int lastYield = Sys_Milliseconds();
	int profileStart = lastYield;
	qboolean previousDemoPlaying = clc.demoplaying;

	*firstTime = 0;
	*lastTime = 0;
	JKA_ResetSummary();
	jka_demoGamestates = 0;
	jka_scanMessages = 0;
	jka_scanMs = 0;

	if ( !name || !name[0] ) {
		return 0;
	}

	Com_sprintf( path, sizeof( path ), "demos/%s.dm_26", name );
	length = FS_FOpenFileRead( path, &file, qtrue );
	if ( length < 8 ) {
		if ( file ) {
			FS_FCloseFile( file );
		}
		return 0;
	}

	jka_lastCommandSeq = clc.serverCommandSequence;
	jka_scanOnly = qtrue;
	clc.demoplaying = qtrue;

	try {
		while ( FS_Read( &sequence, 4, file ) == 4 ) {
			if ( FS_Read( &messageLength, 4, file ) != 4 ) {
				break;
			}
			// WASM is little-endian; FS_Read already gives the native value.
			if ( messageLength == -1 ) {
				break;
			}
			if ( messageLength <= 0 || messageLength > MAX_MSGLEN ) {
				break;
			}
			if ( FS_Read( body, messageLength, file ) != messageLength ) {
				break;
			}

			clc.serverMessageSequence = LittleLong( sequence );
			MSG_Init( &msg, body, sizeof( body ) );
			msg.cursize = messageLength;
			CL_ParseServerMessage( &msg );

			if ( jka_lastCommandSeq < clc.serverCommandSequence - MAX_RELIABLE_COMMANDS ) {
				jka_lastCommandSeq = clc.serverCommandSequence - MAX_RELIABLE_COMMANDS;
			}
			int commandTime = cl.snap.serverTime > 0 ? cl.snap.serverTime : last;

			for ( int commandSeq = jka_lastCommandSeq + 1; commandSeq <= clc.serverCommandSequence; commandSeq++ ) {
				const char *command = clc.serverCommands[commandSeq & ( MAX_RELIABLE_COMMANDS - 1 )];
				char commandName[64];
				int commandNameLen = 0;

				if ( !command || !command[0] ) {
					clc.lastExecutedServerCommand = commandSeq;
					continue;
				}
				while ( command[commandNameLen] && command[commandNameLen] != ' ' &&
					command[commandNameLen] != '\n' && command[commandNameLen] != '\r' &&
					commandNameLen < 63 ) {
					commandName[commandNameLen] = command[commandNameLen];
					commandNameLen++;
				}
				commandName[commandNameLen] = 0;

				// Apply configstring updates so the keyframe's gameState is the
				// same as the one live playback would have.  CL_GetServerCommand
				// also advances lastExecutedServerCommand.
				if ( !Q_stricmp( commandName, "cs" ) ||
					!Q_stricmp( commandName, "bcs0" ) ||
					!Q_stricmp( commandName, "bcs1" ) ||
					!Q_stricmp( commandName, "bcs2" ) ) {
					CL_GetServerCommand( commandSeq );
				} else {
					clc.lastExecutedServerCommand = commandSeq;
					// The team overlay carries teammates' exact health/armor
					// and is only sent to the recorded client.
					if ( !Q_stricmp( commandName, "tinfo" ) ) {
						JKA_ParseTeamInfo( command, commandTime );
					}
				}

				if ( !Q_stricmp( commandName, "map_restart" ) ||
					!Q_stricmp( commandName, "newgame" ) || !Q_stricmp( commandName, "newGame" ) ) {
					jka_mapRestartCount++;
					jka_pendingGameReset = qtrue;
				}
			}
			jka_lastCommandSeq = clc.serverCommandSequence;

			if ( cl.snap.serverTime > 0 ) {
				if ( !first ) {
					first = cl.snap.serverTime;
					jka_firstTime = first;
				}
				last = cl.snap.serverTime;
				jka_lastTime = last;
			}

			if ( cl.snap.messageNum != jka_lastSnapMessageNum && cl.snap.serverTime > 0 ) {
				jka_lastSnapMessageNum = cl.snap.messageNum;
				JKA_ProcessSnapshot( cl.snap.serverTime, FS_FTell( file ) );
			} else {
				JKA_UpdatePlayers( cl.snap.serverTime > 0 ? cl.snap.serverTime : last );
			}

			if ( stopAtTarget && cl.snap.serverTime >= targetTime ) {
				break;
			}

			count++;
			JKA_MaybeYield( &lastYield );
		}
	} catch ( int ) {
		// Malformed demo or a demo command that raised Com_Error; return what
		// has been scanned so far.
	}

	FS_FCloseFile( file );
	jka_scanOnly = qfalse;
	clc.demoplaying = previousDemoPlaying;
	jka_scanMessages = count;
	jka_scanMs = Sys_Milliseconds() - profileStart;
	*firstTime = first;
	*lastTime = last;
	return last;
}

static void JKA_Append( char **out, size_t *left, const char *fmt, ... )
{
	va_list args;
	int written;

	if ( *left == 0 ) {
		return;
	}
	va_start( args, fmt );
	written = vsnprintf( *out, *left, fmt, args );
	va_end( args );
	if ( written < 0 ) {
		**out = 0;
		*left = 0;
		return;
	}
	if ( (size_t)written >= *left ) {
		*out += *left - 1;
		*left = 1;
		return;
	}
	*out += written;
	*left -= (size_t)written;
}

static void JKA_BuildSummary( void )
{
	char *out = jka_summary;
	size_t left = sizeof( jka_summary );
	int gameIndex;

	JKA_Append( &out, &left, "{\"first\":%d,\"duration\":%d,\"fullSnapshots\":%d,\"totalSnapshots\":%d,"
		"\"gamestates\":%d,\"levelStartChanges\":%d,\"mapRestarts\":%d,\"games\":[",
		jka_firstTime, jka_lastTime > jka_firstTime ? jka_lastTime - jka_firstTime : 0,
		jka_fullSnapshots, jka_totalSnapshots, jka_demoGamestates, jka_levelStartChanges, jka_mapRestartCount );

	qboolean firstGame = qtrue;
	for ( gameIndex = 0; gameIndex < jka_gameCount; gameIndex++ ) {
		jkaGame_t *game = &jka_games[gameIndex];
		char map[256];
		int i;
		qboolean hasStats = game->eventCount > 0 ? qtrue : qfalse;

		for ( i = 0; i < game->playerCount && !hasStats; i++ ) {
			hasStats = ( game->players[i].kills > 0 || game->players[i].deaths > 0 ) ? qtrue : qfalse;
		}
		// Drop the short zero-stat restart gaps between real games, but keep
		// the first and last sections so warmup/cooldown are still visible.
		if ( gameIndex > 0 && gameIndex < jka_gameCount - 1 && !hasStats ) {
			continue;
		}

		JKA_JsonEscape( game->map, map, sizeof( map ) );
		JKA_Append( &out, &left,
			"%s{\"map\":\"%s\",\"startTime\":%d,\"endTime\":%d,\"duration\":%d,\"levelTime\":%d,\"eventOverflow\":%s,\"players\":[",
			firstGame ? "" : ",", map, game->startTime, game->endTime,
			game->endTime > game->startTime ? game->endTime - game->startTime : 0,
			game->levelStartTime > 0 && game->endTime > game->levelStartTime ? game->endTime - game->levelStartTime : 0,
			game->eventOverflow ? "true" : "false" );

		for ( i = 0; i < game->playerCount; i++ ) {
			jkaPlayerRecord_t *record = &game->players[i];
			char name[256];
			JKA_JsonEscape( record->name, name, sizeof( name ) );
			JKA_Append( &out, &left,
				"%s{\"num\":%d,\"name\":\"%s\",\"team\":%d,\"score\":%d,\"kills\":%d,\"deaths\":%d,"
				"\"left\":%s,\"leftAt\":%d,\"returned\":%s,\"firstSeen\":%d,\"lastSeen\":%d}",
				i ? "," : "", record->num, name, record->team, record->kills, record->kills, record->deaths,
				record->left && !record->returned ? "true" : "false", record->leftAt,
				record->returned ? "true" : "false", record->firstSeen, record->lastSeen );
		}

		JKA_Append( &out, &left, "],\"events\":[" );
		for ( i = 0; i < game->eventCount; i++ ) {
			jkaEvent_t *event = &game->events[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"target\":%d,\"attacker\":%d,\"mod\":%d,\"friendly\":%d}",
				i ? "," : "", event->time, event->target, event->attacker, event->mod, event->friendly );
		}
		JKA_Append( &out, &left, "],\"vitals\":[" );
		for ( i = 0; i < game->vitalsCount; i++ ) {
			jkaVitals_t *vitals = &game->vitals[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"num\":%d,\"health\":%d,\"armor\":%d,\"source\":%d}",
				i ? "," : "", vitals->time, vitals->num, vitals->health, vitals->armor, vitals->source );
		}
		JKA_Append( &out, &left, "],\"vitalsOverflow\":%s,", game->vitalsOverflow ? "true" : "false" );
		JKA_Append( &out, &left, "\"stances\":[" );
		for ( i = 0; i < game->stanceCount; i++ ) {
			jkaStance_t *stance = &game->stances[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"num\":%d,\"stance\":%d}",
				i ? "," : "", stance->time, stance->num, stance->stance );
		}
		JKA_Append( &out, &left, "],\"stancesOverflow\":%s,", game->stanceOverflow ? "true" : "false" );
		JKA_Append( &out, &left, "\"damages\":[" );
		for ( i = 0; i < game->damageCount; i++ ) {
			jkaDamage_t *damage = &game->damages[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"target\":%d,\"attacker\":%d,\"damage\":%d,\"source\":%d,\"friendly\":%d}",
				i ? "," : "", damage->time, damage->target, damage->attacker, damage->damage, damage->source, damage->friendly );
		}
		JKA_Append( &out, &left, "],\"damageOverflow\":%s,", game->damageOverflow ? "true" : "false" );
		JKA_Append( &out, &left, "\"pov\":%d,\"sabers\":[", game->pov );
		for ( i = 0; i < game->saberCount; i++ ) {
			char saber[128];
			JKA_JsonEscape( game->sabers[i].name, saber, sizeof( saber ) );
			JKA_Append( &out, &left, "%s{\"id\":%d,\"name\":\"%s\"}", i ? "," : "", i, saber );
		}
		JKA_Append( &out, &left, "],\"swings\":[" );
		for ( i = 0; i < game->swingCount; i++ ) {
			jkaSwing_t *swing = &game->swings[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"num\":%d,\"move\":%d,\"stance\":%d,\"saber\":%d,\"hits\":%d,\"damage\":%d}",
				i ? "," : "", swing->time, swing->num, swing->move, swing->stance, swing->saber,
				swing->hits, swing->damage );
		}
		JKA_Append( &out, &left, "],\"swingsOverflow\":%s,", game->swingOverflow ? "true" : "false" );
		JKA_Append( &out, &left, "\"saberHits\":[" );
		for ( i = 0; i < game->saberHitCount; i++ ) {
			jkaSaberHit_t *hit = &game->saberHits[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"attacker\":%d,\"target\":%d,\"attackerState\":%d,\"targetState\":%d}",
				i ? "," : "", hit->time, hit->attacker, hit->target, hit->attackerState, hit->targetState );
		}
		JKA_Append( &out, &left, "],\"saberHitOverflow\":%s,",
			game->saberHitOverflow ? "true" : "false" );
		JKA_Append( &out, &left, "\"blocks\":[" );
		for ( i = 0; i < game->blockCount; i++ ) {
			jkaBlock_t *block = &game->blocks[i];
			JKA_Append( &out, &left, "%s{\"time\":%d,\"winner\":%d,\"loser\":%d,\"kind\":%d}",
				i ? "," : "", block->time, block->winner, block->loser, block->kind );
		}
		JKA_Append( &out, &left, "],\"blockOverflow\":%s,",
			game->blockOverflow ? "true" : "false" );
		// View-angle input-script findings. `swing` is tenths of a degree and
		// `step` the mean/peak percentage of the per-snapshot view step.
		JKA_Append( &out, &left, "\"scripts\":[" );
		for ( i = 0; i < game->scriptCount; i++ ) {
			jkaScriptFlag_t *flag = &game->scripts[i];
			JKA_Append( &out, &left,
				"%s{\"time\":%d,\"endTime\":%d,\"num\":%d,\"channel\":%d,\"reversals\":%d,"
				"\"bursts\":%d,\"meanMs\":%d,\"swing\":%d,\"step\":%d,\"samples\":%d,\"confidence\":%d}",
				i ? "," : "", flag->time, flag->endTime, flag->num, flag->channel,
				flag->reversals, flag->bursts, flag->meanMs, flag->swing, flag->stepPercent,
				flag->samples, flag->confidence );
		}
		JKA_Append( &out, &left, "],\"scriptOverflow\":%s}",
			game->scriptOverflow ? "true" : "false" );
		firstGame = qfalse;
	}

	JKA_Append( &out, &left, "]}" );
	*out = 0;
	jka_summaryValid = qtrue;
}

// A window of recorded player positions for the minimap trails, as
// [clientNum, serverTime, x, y] entries.  The page asks for roughly ten
// seconds around the live time and refreshes as playback advances, so the
// buffer stays small and no full-demo dump is transferred.
EMSCRIPTEN_KEEPALIVE const char *JKA_TrajectoryJson( int from, int to )
{
	char *out = jka_trajectoryJson;
	size_t left = sizeof( jka_trajectoryJson );
	qboolean first = qtrue;
	int i;

	if ( to < from ) {
		int swap = from;
		from = to;
		to = swap;
	}

	JKA_Append( &out, &left, "{\"overflow\":%s,\"samples\":[",
		jka_trajectoryOverflow ? "true" : "false" );
	for ( i = 0; i < jka_trajectoryCount; i++ ) {
		jkaTrajectorySample_t *sample = &jka_trajectory[i];

		if ( sample->time < from || sample->time > to ) {
			continue;
		}
		if ( left < 64 ) {
			// A very wide window or an unusual player count: return the part
			// that fits rather than a truncated JSON document.
			break;
		}
		JKA_Append( &out, &left, "%s[%d,%d,%.0f,%.0f]",
			first ? "" : ",", sample->num, sample->time, sample->x, sample->y );
		first = qfalse;
	}
	JKA_Append( &out, &left, "]}" );
	return jka_trajectoryJson;
}

EMSCRIPTEN_KEEPALIVE const char *JKA_DemoSummaryJson( void )
{
	return jka_summaryValid ? jka_summary : "{\"games\":[]}";
}

EMSCRIPTEN_KEEPALIVE const char *JKA_DemoInfo( const char *name )
{
	static char buffer[192];
	int first = 0;
	int last = 0;
	int profileStart = Sys_Milliseconds();

	emscripten_pause_main_loop();
	CL_Disconnect( qtrue );
	JKA_ScanDemo( name, 0, qfalse, &first, &last );
	CL_Disconnect( qtrue );
	JKA_BuildSummary();
	emscripten_resume_main_loop();

	JKA_BridgeProfileLog( "demo_scan name=%s scanMs=%d totalMs=%d messages=%d snapshots=%d keyframes=%d fullSnapshots=%d gamestates=%d",
		name, jka_scanMs, Sys_Milliseconds() - profileStart, jka_scanMessages, jka_totalSnapshots,
		jka_keyframeCount, jka_fullSnapshots, jka_demoGamestates );

	Com_sprintf( buffer, sizeof( buffer ),
		"{\"first\":%d,\"duration\":%d,\"fullSnapshots\":%d,\"totalSnapshots\":%d,"
		"\"scanMs\":%d,\"messages\":%d,\"keyframes\":%d}",
		first, last > first ? last - first : 0, jka_fullSnapshots, jka_totalSnapshots,
		jka_scanMs, jka_scanMessages, jka_keyframeCount );
	return buffer;
}

static int JKA_GameIndexForTime( int targetTime )
{
	int i;

	if ( jka_gameCount <= 0 ) {
		return -1;
	}
	for ( i = 0; i < jka_gameCount; i++ ) {
		if ( targetTime >= jka_games[i].startTime && targetTime <= jka_games[i].endTime ) {
			return i;
		}
	}
	// Before the first or after the last game; use the nearest end.
	if ( targetTime < jka_games[0].startTime ) {
		return 0;
	}
	return jka_gameCount - 1;
}

static jkaKeyframe_t *JKA_FindKeyframe( int targetTime )
{
	jkaKeyframe_t *best = NULL;
	int gameIndex = JKA_GameIndexForTime( targetTime );
	int i;

	for ( i = 0; i < jka_keyframeCount; i++ ) {
		if ( jka_keyframes[i].time <= targetTime &&
			( gameIndex < 0 || jka_keyframes[i].gameIndex == gameIndex ) &&
			( !best || jka_keyframes[i].time > best->time ) ) {
			best = &jka_keyframes[i];
		}
	}
	if ( best || gameIndex < 0 ) {
		return best;
	}
	// A game without a captured keyframe: fall back to the nearest earlier
	// keyframe; the seek path will reject a map mismatch and reload.
	for ( i = 0; i < jka_keyframeCount; i++ ) {
		if ( jka_keyframes[i].time <= targetTime &&
			( !best || jka_keyframes[i].time > best->time ) ) {
			best = &jka_keyframes[i];
		}
	}
	return best;
}

// Start the demo, restore the nearest parsed keyframe and replay only the
// remaining few seconds.  This is the stock-client equivalent of jaMME's
// indexed demo seek: the full client state is captured during the summary scan.
static int JKA_SeekKeyframe( const char *name, int targetTime )
{
	jkaKeyframe_t *keyframe = JKA_FindKeyframe( targetTime );
	jkaGame_t *game;
	clSnapshot_t targetSnap;
	int lastYield = Sys_Milliseconds();

	if ( !keyframe || targetTime < keyframe->time ) {
		return 0;
	}

	try {
		Cbuf_AddText( va( "demo \"%s\"\n", name ) );
		Cbuf_Execute();
	} catch ( int ) {
		return -1;
	}
	if ( !clc.demofile ) {
		return -1;
	}

	// Parse the gamestate once so the map and cgame are loaded.
	try {
		CL_ReadDemoMessage();
	} catch ( int ) {
		return -1;
	}
	if ( !clc.demofile ) {
		return -1;
	}

	game = ( keyframe->gameIndex >= 0 && keyframe->gameIndex < jka_gameCount )
		? &jka_games[keyframe->gameIndex] : NULL;
	{
		const char *currentMap = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
		if ( !game || !currentMap || Q_stricmp( currentMap, game->map ) ) {
			return -1;
		}
	}
	if ( game && game->hasBaselines ) {
		Com_Memcpy( cl.entityBaselines, game->baselines, sizeof( cl.entityBaselines ) );
	}
	Com_Memcpy( &cl.gameState, &keyframe->gameState, sizeof( cl.gameState ) );
	Com_Memset( cl.snapshots, 0, sizeof( cl.snapshots ) );
	cl.snap = keyframe->snap;
	cl.snap.parseEntitiesNum = 0;
	for ( int i = 0; i < keyframe->entityCount; i++ ) {
		cl.parseEntities[i] = keyframe->entities[i];
	}
	cl.parseEntitiesNum = keyframe->entityCount;
	cl.snapshots[cl.snap.messageNum & PACKET_MASK] = cl.snap;
	clc.serverMessageSequence = cl.snap.messageNum;
	clc.serverCommandSequence = keyframe->serverCommandSequence;
	clc.lastExecutedServerCommand = keyframe->lastExecutedServerCommand;
	clc.clientNum = keyframe->clientNum;
	clc.firstDemoFrameSkipped = qtrue;
	cl.newSnapshots = qfalse;
	cls.state = CA_PRIMED;
	FS_Seek( clc.demofile, keyframe->resumeOffset, FS_SEEK_SET );

	try {
		int lastPos = FS_FTell( clc.demofile );
		while ( clc.demofile && cl.snap.serverTime < targetTime ) {
			CL_ReadDemoMessage();
			if ( !clc.demofile ) {
				break;
			}
			// CL_DemoCompleted leaves the file open at EOF in this build.
			if ( FS_FTell( clc.demofile ) <= lastPos ) {
				break;
			}
			lastPos = FS_FTell( clc.demofile );
			JKA_MaybeYield( &lastYield );
		}
	} catch ( int ) {
		return -1;
	}
	if ( !clc.demofile || !cl.snap.valid ) {
		return -1;
	}

	targetSnap = cl.snap;
	// The cgame was initialised by the gamestate above.  Keep it and let the
	// next frame start from the target snapshot; reinitialising it here would
	// run CG_Init from inside a paused, asyncified client call.
	cl.snap = targetSnap;
	cl.snapshots[targetSnap.messageNum & PACKET_MASK] = targetSnap;
	cl.serverTime = targetSnap.serverTime;
	cl.oldServerTime = targetSnap.serverTime;
	cl.oldFrameServerTime = targetSnap.serverTime;
	cl.newSnapshots = qfalse;
	clc.firstDemoFrameSkipped = qtrue;
	cls.state = CA_PRIMED;
	return 1;
}

// M9 Phase 5: seek inside the live demo.  The map, renderer and cgame stay
// resident; only the client snapshot/configstring state and the cgame are
// rebuilt.  This is the same keyframe restore as JKA_SeekKeyframe, minus the
// "demo" command/CL_Disconnect/map load.
static int JKA_SeekKeyframeWarm( int targetTime )
{
	jkaKeyframe_t *keyframe = JKA_FindKeyframe( targetTime );
	jkaGame_t *game;
	const char *currentMap;
	int profileStart = Sys_Milliseconds();
	int lastYield = profileStart;
	int firstSnapshot;
	int targetSnapshot;

	if ( !keyframe || targetTime < keyframe->time ) {
		JKA_BridgeProfileLog( "seek-warm skip no-keyframe target=%d keyframes=%d", targetTime, jka_keyframeCount );
		return 0;
	}
	if ( !clc.demofile || !clc.demoplaying || cls.state != CA_ACTIVE ) {
		JKA_BridgeProfileLog( "seek-warm skip not-active target=%d demo=%d state=%d file=%d",
			targetTime, clc.demoplaying ? 1 : 0, (int)cls.state, clc.demofile ? 1 : 0 );
		return 0;
	}
	if ( keyframe->gameIndex < 0 || keyframe->gameIndex >= jka_gameCount ) {
		JKA_BridgeProfileLog( "seek-warm skip bad-game keyframe=%d gameIndex=%d games=%d",
			keyframe->snap.serverTime, keyframe->gameIndex, jka_gameCount );
		return 0;
	}
	game = &jka_games[keyframe->gameIndex];
	currentMap = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
	if ( !currentMap || !currentMap[0] || Q_stricmp( currentMap, game->map ) ) {
		// A different map still needs the full Renderer/cgame load.
		JKA_BridgeProfileLog( "seek-warm skip map target=%d current=%s keyframe=%s",
			targetTime, currentMap ? currentMap : "", game->map );
		return 0;
	}

	if ( game->hasBaselines ) {
		Com_Memcpy( cl.entityBaselines, game->baselines, sizeof( cl.entityBaselines ) );
	}
	Com_Memcpy( &cl.gameState, &keyframe->gameState, sizeof( cl.gameState ) );
	Com_Memset( cl.snapshots, 0, sizeof( cl.snapshots ) );
	cl.snap = keyframe->snap;
	cl.snap.parseEntitiesNum = 0;
	for ( int i = 0; i < keyframe->entityCount; i++ ) {
		cl.parseEntities[i] = keyframe->entities[i];
	}
	cl.parseEntitiesNum = keyframe->entityCount;
	cl.snapshots[cl.snap.messageNum & PACKET_MASK] = cl.snap;
	clc.serverMessageSequence = cl.snap.messageNum;
	clc.serverCommandSequence = keyframe->serverCommandSequence;
	clc.lastExecutedServerCommand = keyframe->lastExecutedServerCommand;
	clc.clientNum = keyframe->clientNum;
	clc.firstDemoFrameSkipped = qtrue;
	cl.newSnapshots = qfalse;
	FS_Seek( clc.demofile, keyframe->resumeOffset, FS_SEEK_SET );
	JKA_BridgeProfileLog( "seek-warm phase=restored keyframe=%d target=%d filePos=%d",
		keyframe->snap.serverTime, targetTime, FS_FTell( clc.demofile ) );

	try {
		int lastPos = FS_FTell( clc.demofile );
		while ( clc.demofile && cl.snap.serverTime < targetTime ) {
			CL_ReadDemoMessage();
			if ( !clc.demofile ) {
				break;
			}
			if ( FS_FTell( clc.demofile ) <= lastPos ) {
				break;
			}
			lastPos = FS_FTell( clc.demofile );
			JKA_MaybeYield( &lastYield );
		}
	} catch ( int ) {
		JKA_BridgeProfileLog( "seek-warm skip replay-error target=%d", targetTime );
		return -1;
	}
	if ( !clc.demofile || !cl.snap.valid ) {
		JKA_BridgeProfileLog( "seek-warm skip replay-eof target=%d", targetTime );
		return -1;
	}
	JKA_BridgeProfileLog( "seek-warm phase=replayed target=%d snapTime=%d filePos=%d",
		targetTime, cl.snap.serverTime, FS_FTell( clc.demofile ) );

	targetSnapshot = cl.snap.messageNum;
	// Give the cgame the oldest snapshot still in the client ring.  Older
	// snapshots cannot be read back, and every snapshot carries a full entity
	// list, so starting at the ring edge is safe.
	firstSnapshot = targetSnapshot - ( PACKET_BACKUP - 2 );
	if ( firstSnapshot < keyframe->snap.messageNum ) {
		firstSnapshot = keyframe->snap.messageNum;
	}

	cl.serverTime = cl.snap.serverTime;
	cl.serverTimeDelta = cl.snap.serverTime - cls.realtime;
	cl.oldServerTime = cl.snap.serverTime;
	cl.oldFrameServerTime = cl.snap.serverTime;
	cl.newSnapshots = qfalse;
	clc.firstDemoFrameSkipped = qtrue;
	cls.state = CA_ACTIVE;
	jka_demoEnded = qfalse;

	JKA_BridgeProfileLog( "seek-warm phase=reset-start first=%d", firstSnapshot );
	CGVM_SeekReset( firstSnapshot, keyframe->serverCommandSequence, clc.serverCommandSequence, keyframe->clientNum );
	JKA_BridgeProfileLog( "seek-warm phase=reset-done first=%d", firstSnapshot );

	JKA_BridgeProfileLog( "seek target=%d path=warm-inplace keyframe=%d first=%d levelStart=%s serverTime=%d ms=%d",
		targetTime, keyframe->snap.serverTime, firstSnapshot,
		JKA_ConfigString( CS_LEVEL_START_TIME ), cl.snap.serverTime, Sys_Milliseconds() - profileStart );
	return 1;
}

EMSCRIPTEN_KEEPALIVE void JKA_SeekDemo( const char *name, int targetTime )
{
	int profileStart = Sys_Milliseconds();

	if ( !name || !name[0] ) {
		return;
	}

	emscripten_pause_main_loop();

	// The in-place path keeps the map, renderer and cgame loaded for any seek
	// inside the same map, including backward seeks.
	if ( JKA_SeekKeyframeWarm( targetTime ) == 1 ) {
		emscripten_resume_main_loop();
		return;
	}

	CL_Disconnect( qtrue );

	if ( JKA_SeekKeyframe( name, targetTime ) == 1 ) {
		JKA_BridgeProfileLog( "seek target=%d path=keyframe ms=%d", targetTime, Sys_Milliseconds() - profileStart );
		emscripten_resume_main_loop();
		return;
	}

	// No keyframe (for example a cached summary without an in-session scan),
	// or the keyframe path failed.  Fall back to replaying from the start.
	CL_Disconnect( qtrue );

	try {
		Cbuf_AddText( va( "demo \"%s\"\n", name ) );
		Cbuf_Execute();
	} catch ( int ) {
		emscripten_resume_main_loop();
		return;
	}

	if ( clc.demofile ) {
		int lastYield = Sys_Milliseconds();
		try {
			int lastPos = FS_FTell( clc.demofile );
			while ( clc.demofile && cl.snap.serverTime < targetTime ) {
				CL_ReadDemoMessage();
				if ( !clc.demofile ) {
					break;
				}
				if ( FS_FTell( clc.demofile ) <= lastPos ) {
					break;
				}
				lastPos = FS_FTell( clc.demofile );
				JKA_MaybeYield( &lastYield );
			}
		} catch ( int ) {
			// The target was at or past the end; leave the ended state to the
			// normal status bridge.
		}
	}

	JKA_BridgeProfileLog( "seek target=%d path=replay ms=%d", targetTime, Sys_Milliseconds() - profileStart );
	emscripten_resume_main_loop();
}

// Parse the first gamestate of a demo and return CS_SERVERINFO's mapname.
// Uses the engine's own MSG/Huffman decoder, so no second parser is needed.
EMSCRIPTEN_KEEPALIVE const char *JKA_ParseDemoMap( const char *name )
{
	static char mapBuffer[128];
	char path[256];
	char serverInfo[BIG_INFO_STRING];
	byte body[MAX_MSGLEN];
	fileHandle_t file = 0;
	msg_t msg;
	int length;
	int messageLength;
	int cmd;

	mapBuffer[0] = 0;
	if ( !name || !name[0] ) {
		return mapBuffer;
	}

	Com_sprintf( path, sizeof( path ), "demos/%s.dm_26", name );
	length = FS_FOpenFileRead( path, &file, qtrue );
	if ( length < 8 ) {
		if ( file ) {
			FS_FCloseFile( file );
		}
		return mapBuffer;
	}

	FS_Read( &length, 4, file );
	FS_Read( &messageLength, 4, file );
	if ( messageLength <= 0 || messageLength > MAX_MSGLEN ) {
		FS_FCloseFile( file );
		return mapBuffer;
	}
	if ( FS_Read( body, messageLength, file ) != messageLength ) {
		FS_FCloseFile( file );
		return mapBuffer;
	}
	FS_FCloseFile( file );

	MSG_Init( &msg, body, messageLength );
	msg.cursize = messageLength;
	msg.readcount = 0;
	MSG_Bitstream( &msg );

	MSG_ReadLong( &msg ); // reliable acknowledge
	if ( MSG_ReadByte( &msg ) != svc_gamestate ) {
		return mapBuffer;
	}
	MSG_ReadLong( &msg ); // server command sequence

	serverInfo[0] = 0;
	for ( ;; ) {
		cmd = MSG_ReadByte( &msg );
		if ( cmd != svc_configstring ) {
			break;
		}
		{
			int index = MSG_ReadShort( &msg );
			char *value = MSG_ReadBigString( &msg );
			if ( index == CS_SERVERINFO ) {
				Q_strncpyz( serverInfo, value, sizeof( serverInfo ) );
			}
		}
	}

	Q_strncpyz( mapBuffer, Info_ValueForKey( serverInfo, "mapname" ), sizeof( mapBuffer ) );
	return mapBuffer;
}

EMSCRIPTEN_KEEPALIVE int JKA_HasMap( const char *map )
{
	char path[256];
	fileHandle_t file = 0;
	long length;

	if ( !map || !map[0] ) {
		return 0;
	}
	Com_sprintf( path, sizeof( path ), "maps/%s.bsp", map );
	length = FS_FOpenFileRead( path, &file, qtrue );
	if ( length <= 0 ) {
		if ( file ) {
			FS_FCloseFile( file );
		}
		return 0;
	}
	FS_FCloseFile( file );
	return 1;
}

EMSCRIPTEN_KEEPALIVE void JKA_RestartFS( void )
{
	FS_Restart( 0, qtrue );
}

EMSCRIPTEN_KEEPALIVE const char *JKA_ScoreboardJson( void )
{
	return CG_GetScoreboardJson();
}

// Live player positions for the minimap. Client-side only: remote players come
// from the current snapshot's entity ring (the recorded POV's own entity is not
// in the demo), and the POV is read from cl.snap.ps. Positions are raw snapshot
// origins; the page smooths them between polls.
EMSCRIPTEN_KEEPALIVE const char *JKA_RadarJson( void )
{
	static char buffer[8192];
	qboolean first = qtrue;
	int len;
	int i;

	if ( cls.state != CA_ACTIVE || !cl.snap.valid ) {
		return "{\"time\":0,\"players\":[]}";
	}

	len = snprintf( buffer, sizeof( buffer ), "{\"time\":%d,\"players\":[", cl.snap.serverTime );

	{
		playerState_t *ps = &cl.snap.ps;

		if ( ps->clientNum >= 0 && ps->clientNum < MAX_CLIENTS &&
			ps->pm_type != PM_SPECTATOR && ps->pm_type != PM_INTERMISSION ) {
			len += snprintf( buffer + len, sizeof( buffer ) - len,
				"{\"num\":%d,\"x\":%.2f,\"y\":%.2f,\"z\":%.2f,\"yaw\":%.2f,\"dead\":%d,\"g\":%d}",
				ps->clientNum, ps->origin[0], ps->origin[1], ps->origin[2],
				AngleNormalize180( ps->viewangles[YAW] ),
				ps->stats[STAT_HEALTH] > 0 ? 0 : 1,
				ps->groundEntityNum != ENTITYNUM_NONE ? 1 : 0 );
			if ( len > (int)sizeof( buffer ) - 1 ) {
				len = (int)sizeof( buffer ) - 1;
			}
			first = qfalse;
		}
	}

	for ( i = 0; i < cl.snap.numEntities && len < (int)sizeof( buffer ) - 128; i++ ) {
		entityState_t *state = &cl.parseEntities[
			( cl.snap.parseEntitiesNum + i ) & ( MAX_PARSE_ENTITIES - 1 )];

		if ( state->eType != ET_PLAYER || state->number < 0 || state->number >= MAX_CLIENTS ) {
			continue;
		}
		if ( state->number == cl.snap.ps.clientNum ) {
			continue;
		}

		len += snprintf( buffer + len, sizeof( buffer ) - len,
			"%s{\"num\":%d,\"x\":%.2f,\"y\":%.2f,\"z\":%.2f,\"yaw\":%.2f,\"dead\":%d,\"g\":%d}",
			first ? "" : ",", state->number,
			state->pos.trBase[0], state->pos.trBase[1], state->pos.trBase[2],
			AngleNormalize180( state->apos.trBase[YAW] ),
			( state->eFlags & EF_DEAD ) ? 1 : 0,
			state->groundEntityNum != ENTITYNUM_NONE ? 1 : 0 );
		if ( len > (int)sizeof( buffer ) - 1 ) {
			len = (int)sizeof( buffer ) - 1;
		}
		first = qfalse;
	}

	snprintf( buffer + len, sizeof( buffer ) - len, "]}" );
	buffer[sizeof( buffer ) - 1] = 0;
	return buffer;
}

EMSCRIPTEN_KEEPALIVE void JKA_FollowClient( int clientNum )
{
	CG_SetFollowClient( clientNum );
}

EMSCRIPTEN_KEEPALIVE const char *JKA_EnableFreeCam( void )
{
	return CG_EnableFreeCam();
}

EMSCRIPTEN_KEEPALIVE void JKA_SetFreeCamPose( float x, float y, float z, float pitch, float yaw, float roll )
{
	CG_SetFreeCamPose( x, y, z, pitch, yaw, roll );
}

EMSCRIPTEN_KEEPALIVE void JKA_DisableFreeCam( void )
{
	CG_DisableFreeCam();
}

EMSCRIPTEN_KEEPALIVE void JKA_SetCvar( const char *name, const char *value )
{
	if ( name && value ) {
		Cvar_Set( name, value );
	}
}

EMSCRIPTEN_KEEPALIVE const char *JKA_GetCvar( const char *name )
{
	return name ? Cvar_VariableString( name ) : "";
}

}
