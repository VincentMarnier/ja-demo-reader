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
	if ( !name || !name[0] ) {
		return;
	}
	Cvar_Set( "cl_allowDownload", "0" );
	Cbuf_AddText( va( "demo %s\n", name ) );
	Cbuf_Execute();
}

EMSCRIPTEN_KEEPALIVE void JKA_StopDemo( void )
{
	Cbuf_AddText( "disconnect\n" );
	Cbuf_Execute();
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

}
