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

#include "client/client.h"
#include "qcommon/qcommon.h"

qboolean jka_demoEnded = qfalse;

extern "C" {

EMSCRIPTEN_KEEPALIVE const char *JKA_StatusJson( void )
{
	static char buffer[1024];
	const char *map = cl.mapname;

	Com_sprintf( buffer, sizeof( buffer ),
		"{\"state\":%d,\"demo\":%d,\"serverTime\":%d,\"snapTime\":%d,"
		"\"clientNum\":%d,\"map\":\"%s\",\"ended\":%d}",
		(int)cls.state,
		clc.demoplaying ? 1 : 0,
		cl.serverTime,
		cl.snap.serverTime,
		clc.clientNum,
		map ? map : "",
		jka_demoEnded ? 1 : 0 );

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

}
