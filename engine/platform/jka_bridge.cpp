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
#include <cstdio>
#include <cstdarg>

#include "client/client.h"
#include "qcommon/qcommon.h"

qboolean jka_demoEnded = qfalse;
qboolean jka_engineReady = qfalse;

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
		"\"clientNum\":%d,\"map\":\"%s\",\"ended\":%d,\"ready\":%d}",
		(int)cls.state,
		clc.demoplaying ? 1 : 0,
		cl.serverTime,
		cl.snap.serverTime,
		clc.clientNum,
		map ? map : "",
		jka_demoEnded ? 1 : 0,
		jka_engineReady ? 1 : 0 );

	return buffer;
}

EMSCRIPTEN_KEEPALIVE void JKA_PlayDemo( const char *name )
{
	const char *p;

	if ( !name || !name[0] ) {
		return;
	}
	// The engine's console tokenizer splits on spaces; quote the name and
	// reject characters that could break out of the quoted argument.
	for ( p = name; *p; p++ ) {
		if ( *p == '"' || *p == '\n' || *p == '\r' || *p == ';' ) {
			Com_Printf( "JKA_PlayDemo: invalid demo name\n" );
			return;
		}
	}
	Cvar_Set( "cl_allowDownload", "0" );
	Cbuf_AddText( va( "demo \"%s\"\n", name ) );
	Cbuf_Execute();
}

EMSCRIPTEN_KEEPALIVE void JKA_StopDemo( void )
{
	char message[] = "Server disconnected";

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
}

EMSCRIPTEN_KEEPALIVE void JKA_SetPaused( int paused )
{
	Cvar_Get( "r_m2_pause", "0", 0 );
	Cvar_Set( "r_m2_pause", paused ? "1" : "0" );
}

EMSCRIPTEN_KEEPALIVE void JKA_Resume( void )
{
	emscripten_resume_main_loop();
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
#define JKA_SUMMARY_SIZE    (4 * 1024 * 1024)

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
} jkaEvent_t;

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
	jkaPlayerRecord_t players[JKA_MAX_RECORDS];
	int			playerCount;
	jkaEvent_t	events[JKA_MAX_EVENTS];
	int			eventCount;
	qboolean	eventOverflow;
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
static char			jka_summary[JKA_SUMMARY_SIZE];
static qboolean		jka_summaryValid = qfalse;

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

static void JKA_ResetSummary( void )
{
	Com_Memset( jka_games, 0, sizeof( jka_games ) );
	jka_gameCount = 0;
	jka_currentGame = -1;
	jka_firstTime = 0;
	jka_lastTime = 0;
	jka_fullSnapshots = 0;
	jka_totalSnapshots = 0;
	jka_lastSnapMessageNum = -1;
	jka_lastEventTime = -1;
	jka_lastEventTarget = -1;
	jka_lastEventAttacker = -1;
	jka_lastEventMod = -1;
	jka_snapshotSerial = 0;
	jka_keyframeCount = 0;
	jka_lastKeyframeTime = 0;
	Com_Memset( jka_eventEntitySeen, 0, sizeof( jka_eventEntitySeen ) );
	Com_Memset( jka_eventEntityValue, 0, sizeof( jka_eventEntityValue ) );
	jka_summary[0] = 0;
	jka_summaryValid = qfalse;
	for ( int i = 0; i < MAX_CLIENTS; i++ ) {
		jka_slotRecord[i] = -1;
		jka_slotHash[i] = 0;
	}
}

static jkaGame_t *JKA_CurrentGame( void )
{
	if ( jka_currentGame < 0 || jka_currentGame >= jka_gameCount ) {
		return NULL;
	}
	return &jka_games[jka_currentGame];
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

	if ( !record ) {
		jka_slotRecord[slot] = -1;
		return;
	}
	record->active = qfalse;
	record->left = qtrue;
	record->leftAt = now;
	record->lastSeen = now;
	jka_slotRecord[slot] = -1;
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
		} else {
			record = JKA_AddRecord( game, slot, name, team, now, qfalse );
			if ( record ) {
				jka_slotRecord[slot] = game->playerCount - 1;
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
	mapname = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
	Q_strncpyz( game->map, mapname && mapname[0] ? mapname : "unknown", sizeof( game->map ) );
	Com_Memcpy( game->baselines, cl.entityBaselines, sizeof( game->baselines ) );
	game->hasBaselines = qtrue;

	jka_currentGame = jka_gameCount - 1;
	for ( int i = 0; i < MAX_CLIENTS; i++ ) {
		jka_slotRecord[i] = -1;
		jka_slotHash[i] = 0;
	}
	jka_lastSnapMessageNum = -1;
	jka_lastEventTime = -1;
	jka_lastEventTarget = -1;
	jka_lastEventAttacker = -1;
	jka_lastEventMod = -1;
	Com_Memset( jka_eventEntitySeen, 0, sizeof( jka_eventEntitySeen ) );
	Com_Memset( jka_eventEntityValue, 0, sizeof( jka_eventEntityValue ) );

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
	} else {
		game->eventOverflow = qtrue;
	}

	JKA_EnsureRecord( game, target, now );
	record = JKA_ActiveRecord( game, target );
	if ( record ) {
		record->deaths++;
		record->lastSeen = now;
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

static void JKA_ProcessSnapshot( int now, int resumeOffset )
{
	jkaGame_t *game = JKA_CurrentGame();
	const char *mapname;
	int i;

	mapname = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
	if ( !game || jka_demoGamestates > game->gamestateId ||
		( mapname && mapname[0] && Q_stricmp( game->map, mapname ) ) ) {
		JKA_StartGame( now, jka_demoGamestates );
		game = JKA_CurrentGame();
	}
	if ( !game ) {
		return;
	}

	game->endTime = now;
	game->levelStartTime = atoi( JKA_ConfigString( CS_LEVEL_START_TIME ) );
	JKA_UpdatePlayers( now );

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

	for ( i = 0; i < cl.snap.numEntities && i < MAX_PARSE_ENTITIES; i++ ) {
		entityState_t *state = &cl.parseEntities[( cl.snap.parseEntitiesNum + i ) & ( MAX_PARSE_ENTITIES - 1 )];
		int event;

		if ( state->eType < ET_EVENTS ) {
			continue;
		}
		// Freestanding event entities carry the event in eType, not event.
		event = state->eType - ET_EVENTS;
		if ( event != EV_OBITUARY ) {
			continue;
		}
		// The server repeats a temp entity for a few snapshots.  cgame keeps
		// a per-entity previousEvent; mirror that so one obituary is one kill.
		if ( state->number >= 0 && state->number < MAX_GENTITIES ) {
			if ( jka_eventEntitySeen[state->number] == jka_snapshotSerial - 1 &&
				jka_eventEntityValue[state->number] == event ) {
				jka_eventEntitySeen[state->number] = jka_snapshotSerial;
				continue;
			}
			jka_eventEntitySeen[state->number] = jka_snapshotSerial;
			jka_eventEntityValue[state->number] = event;
		}
		JKA_TrackObituary( now, state->otherEntityNum, state->otherEntityNum2, state->eventParm );
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

	*firstTime = 0;
	*lastTime = 0;
	JKA_ResetSummary();
	jka_demoGamestates = 0;

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

	try {
		while ( FS_Read( &sequence, 4, file ) == 4 ) {
			if ( FS_Read( &messageLength, 4, file ) != 4 ) {
				break;
			}
			messageLength = LittleLong( messageLength );
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

			if ( ( ++count & 127 ) == 0 ) {
				emscripten_sleep( 0 );
			}
		}
	} catch ( int ) {
		// Malformed demo or a demo command that raised Com_Error; return what
		// has been scanned so far.
	}

	FS_FCloseFile( file );
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

	JKA_Append( &out, &left, "{\"first\":%d,\"duration\":%d,\"fullSnapshots\":%d,\"totalSnapshots\":%d,\"games\":[",
		jka_firstTime, jka_lastTime > jka_firstTime ? jka_lastTime - jka_firstTime : 0,
		jka_fullSnapshots, jka_totalSnapshots );

	for ( gameIndex = 0; gameIndex < jka_gameCount; gameIndex++ ) {
		jkaGame_t *game = &jka_games[gameIndex];
		char map[256];
		int i;

		JKA_JsonEscape( game->map, map, sizeof( map ) );
		JKA_Append( &out, &left,
			"%s{\"map\":\"%s\",\"startTime\":%d,\"endTime\":%d,\"duration\":%d,\"levelTime\":%d,\"eventOverflow\":%s,\"players\":[",
			gameIndex ? "," : "", map, game->startTime, game->endTime,
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
			JKA_Append( &out, &left, "%s{\"time\":%d,\"target\":%d,\"attacker\":%d,\"mod\":%d}",
				i ? "," : "", event->time, event->target, event->attacker, event->mod );
		}
		JKA_Append( &out, &left, "]}" );
	}

	JKA_Append( &out, &left, "]}" );
	*out = 0;
	jka_summaryValid = qtrue;
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

	emscripten_pause_main_loop();
	CL_Disconnect( qtrue );
	JKA_ScanDemo( name, 0, qfalse, &first, &last );
	CL_Disconnect( qtrue );
	JKA_BuildSummary();
	emscripten_resume_main_loop();

	Com_sprintf( buffer, sizeof( buffer ),
		"{\"first\":%d,\"duration\":%d,\"fullSnapshots\":%d,\"totalSnapshots\":%d}",
		first, last > first ? last - first : 0, jka_fullSnapshots, jka_totalSnapshots );
	return buffer;
}

static jkaKeyframe_t *JKA_FindKeyframe( int targetTime )
{
	jkaKeyframe_t *best = NULL;
	int i;

	for ( i = 0; i < jka_keyframeCount; i++ ) {
		if ( jka_keyframes[i].time <= targetTime &&
			( !best || jka_keyframes[i].time > best->time ) ) {
			best = &jka_keyframes[i];
		}
	}
	return best;
}

// Seek inside the already loaded demo: no map reload, no cgame reinit.  This
// keeps the jump close to jaMME's indexed seek once the map is warm.
static int JKA_SeekKeyframeExisting( int targetTime )
{
	jkaKeyframe_t *keyframe = JKA_FindKeyframe( targetTime );
	jkaGame_t *game;
	int count = 0;

	if ( !keyframe || targetTime < keyframe->time ) {
		return 0;
	}
	if ( !clc.demofile || cls.state != CA_ACTIVE || !clc.demoplaying ) {
		return 0;
	}

	game = ( keyframe->gameIndex >= 0 && keyframe->gameIndex < jka_gameCount )
		? &jka_games[keyframe->gameIndex] : NULL;
	{
		const char *currentMap = Info_ValueForKey( JKA_ConfigString( CS_SERVERINFO ), "mapname" );
		if ( !game || !currentMap || Q_stricmp( currentMap, game->map ) ) {
			return 0;
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
	FS_Seek( clc.demofile, keyframe->resumeOffset, FS_SEEK_SET );

	try {
		while ( clc.demofile && cl.snap.serverTime < targetTime ) {
			CL_ReadDemoMessage();
			if ( !clc.demofile ) {
				break;
			}
			if ( ( ++count & 127 ) == 0 ) {
				emscripten_sleep( 0 );
			}
		}
	} catch ( int ) {
		return -1;
	}
	if ( !clc.demofile || !cl.snap.valid ) {
		return -1;
	}

	cl.serverTime = cl.snap.serverTime;
	cl.serverTimeDelta = cl.snap.serverTime - cls.realtime;
	cl.oldServerTime = cl.snap.serverTime;
	cl.oldFrameServerTime = cl.snap.serverTime;
	cl.newSnapshots = qfalse;
	clc.firstDemoFrameSkipped = qtrue;
	return 1;
}

// Start the demo, restore the nearest parsed keyframe and replay only the
// remaining few seconds.  This is the stock-client equivalent of jaMME's
// indexed demo seek: the full client state is captured during the summary scan.
static int JKA_SeekKeyframe( const char *name, int targetTime )
{
	jkaKeyframe_t *keyframe = JKA_FindKeyframe( targetTime );
	jkaGame_t *game;
	clSnapshot_t targetSnap;
	int count = 0;

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
		while ( clc.demofile && cl.snap.serverTime < targetTime ) {
			CL_ReadDemoMessage();
			if ( !clc.demofile ) {
				break;
			}
			if ( ( ++count & 127 ) == 0 ) {
				emscripten_sleep( 0 );
			}
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

EMSCRIPTEN_KEEPALIVE void JKA_SeekDemo( const char *name, int targetTime )
{
	if ( !name || !name[0] ) {
		return;
	}

	emscripten_pause_main_loop();

	// The warm path avoids a map reload, but cgame tolerates a forward time
	// jump only; a backward seek goes through the restart path below.
	if ( targetTime >= cl.snap.serverTime && JKA_SeekKeyframeExisting( targetTime ) == 1 ) {
		emscripten_resume_main_loop();
		return;
	}

	CL_Disconnect( qtrue );

	if ( JKA_SeekKeyframe( name, targetTime ) == 1 ) {
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
		int count = 0;
		try {
			while ( clc.demofile && cl.snap.serverTime < targetTime ) {
				CL_ReadDemoMessage();
				if ( !clc.demofile ) {
					break;
				}
				if ( ( ++count & 127 ) == 0 ) {
					emscripten_sleep( 0 );
				}
			}
		} catch ( int ) {
			// The target was at or past the end; leave the ended state to the
			// normal status bridge.
		}
	}

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
