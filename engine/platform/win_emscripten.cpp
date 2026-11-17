/*
===========================================================================
Copyright (C) 2026 jka-demo-player contributors

This file is part of the OpenJK source code.

OpenJK is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License version 2 as
published by the Free Software Foundation.
===========================================================================
*/

// M9 Phase 3: a minimal window/GL layer for a dedicated Web Worker.
//
// The stock Emscripten build uses shared/sdl/sdl_window.cpp.  SDL's browser
// video backend is main-thread only: it creates DOM canvases, registers input
// handlers and reads document/window before it will hand out a GL context.
// None of that exists in a worker.  This file provides the same six entry
// points the renderer uses, backed by Emscripten's HTML5/WebGL2 API and the
// OffscreenCanvas the app transferred in.
//
// It is selected at runtime (see JKA_WorkerWindowActive) and only when
// Module.canvas is an OffscreenCanvas, so a normal page keeps the SDL path.

#include <stdlib.h>

#include <emscripten.h>
#include <emscripten/html5.h>
#include <emscripten/html5_webgl.h>

#include "qcommon/qcommon.h"
#include "rd-common/tr_types.h"
#include "sys/sys_local.h"

static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE jka_glContext = 0;
static int jka_canvasWidth = 800;
static int jka_canvasHeight = 600;

static cvar_t *jka_rSwapInterval;

// True only when the module owns an OffscreenCanvas.  EM_ASM code is injected
// into the module scope, where Module is the object the worker configured.
static qboolean JKA_IsOffscreenCanvas( void )
{
	// Called from CL_InitRef and from Com_Frame every frame (to skip the DOM
	// input path), so resolve it once.
	static int isOffscreen = -1;

	if ( isOffscreen < 0 ) {
		isOffscreen = EM_ASM_INT( {
			return ( typeof OffscreenCanvas !== 'undefined' &&
				typeof Module !== 'undefined' && Module[ 'canvas' ] &&
				Module[ 'canvas' ] instanceof OffscreenCanvas ) ? 1 : 0;
		} );
	}

	return isOffscreen ? qtrue : qfalse;
}

extern "C" qboolean JKA_WorkerWindowActive( void )
{
	return JKA_IsOffscreenCanvas();
}

static void JKA_RegisterWindowCvars( void )
{
	// The renderer and CVAR_LATCH handling expect these to exist.  The SDL
	// window layer registers the same set; only a subset is meaningful for an
	// OffscreenCanvas, and the browser owns the real surface attributes.
	Cvar_Get( "r_sdlDriver", "", CVAR_ROM, "" );
	Cvar_Get( "r_allowSoftwareGL", "0", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_fullscreen", "0", CVAR_ARCHIVE | CVAR_LATCH, "" );
	Cvar_Get( "r_noborder", "0", CVAR_ARCHIVE | CVAR_LATCH, "" );
	Cvar_Get( "r_centerWindow", "0", CVAR_ARCHIVE | CVAR_LATCH, "" );
	Cvar_Get( "r_customwidth", "1600", CVAR_ARCHIVE | CVAR_LATCH, "" );
	Cvar_Get( "r_customheight", "1024", CVAR_ARCHIVE | CVAR_LATCH, "" );
	jka_rSwapInterval = Cvar_Get( "r_swapInterval", "0", CVAR_ARCHIVE_ND, "" );
	Cvar_Get( "r_stereo", "0", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_mode", "4", CVAR_ARCHIVE | CVAR_LATCH, "" );
	Cvar_Get( "r_displayRefresh", "0", CVAR_LATCH, "" );
	Cvar_Get( "r_stencilbits", "8", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_depthbits", "0", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_colorbits", "0", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_ignorehwgamma", "0", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_ext_multisample", "0", CVAR_ARCHIVE_ND | CVAR_LATCH, "" );
	Cvar_Get( "r_availableModes", "", CVAR_ROM, "" );
}

static void JKA_ResolveCanvasSize( void )
{
	int width = 0;
	int height = 0;

	if ( emscripten_get_canvas_element_size( 0, &width, &height ) == EMSCRIPTEN_RESULT_SUCCESS &&
		width > 0 && height > 0 ) {
		jka_canvasWidth = width;
		jka_canvasHeight = height;
		return;
	}

	// r_mode -1 lets the user request a custom size on the main thread; keep
	// the same behaviour for the worker canvas, which accepts resizes.
	if ( Cvar_VariableIntegerValue( "r_mode" ) == -1 ) {
		const int customWidth = Cvar_VariableIntegerValue( "r_customwidth" );
		const int customHeight = Cvar_VariableIntegerValue( "r_customheight" );
		if ( customWidth > 0 && customHeight > 0 ) {
			jka_canvasWidth = customWidth;
			jka_canvasHeight = customHeight;
			emscripten_set_canvas_element_size( 0, jka_canvasWidth, jka_canvasHeight );
		}
	}
}

extern "C" window_t JKA_WIN_Init( const windowDesc_t *windowDesc, glconfig_t *glConfig )
{
	EmscriptenWebGLContextAttributes attributes;
	window_t window = {};

	JKA_RegisterWindowCvars();
	JKA_ResolveCanvasSize();

	if ( jka_glContext ) {
		emscripten_webgl_destroy_context( jka_glContext );
		jka_glContext = 0;
	}

	emscripten_webgl_init_context_attributes( &attributes );
	// The engine build is WebGL2/GLES3 only.  Request no desktop-style
	// attributes: Emscripten maps these onto the browser context.
	attributes.majorVersion = 2;
	attributes.minorVersion = 0;
	attributes.alpha = 0;
	attributes.depth = 1;
	attributes.stencil = 1;
	attributes.antialias = 0;
	attributes.premultipliedAlpha = 0;
	attributes.preserveDrawingBuffer = 0;
	attributes.enableExtensionsByDefault = 1;
	attributes.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
	attributes.failIfMajorPerformanceCaveat = 0;

	// Target 0 means Module.canvas with the legacy target lookup enabled by
	// -sDISABLE_DEPRECATED_FIND_EVENT_TARGET_BEHAVIOR=0 in the build script.
	// The newer lookup resolves only DOM selectors, which do not exist in a
	// worker.  Module.canvas is the OffscreenCanvas transferred by the app.
	jka_glContext = emscripten_webgl_create_context( 0, &attributes );
	if ( jka_glContext == 0 ) {
		Com_Error( ERR_FATAL, "Could not create a WebGL2 context on the OffscreenCanvas (error %d)\n",
			(int)jka_glContext );
	}
	if ( emscripten_webgl_make_context_current( jka_glContext ) != EMSCRIPTEN_RESULT_SUCCESS ) {
		Com_Error( ERR_FATAL, "Could not make the OffscreenCanvas WebGL2 context current\n" );
	}

	glConfig->vidWidth = jka_canvasWidth;
	glConfig->vidHeight = jka_canvasHeight;
	glConfig->colorBits = 24;
	glConfig->depthBits = 24;
	glConfig->stencilBits = 8;
	glConfig->isFullscreen = qfalse;
	glConfig->stereoEnabled = qfalse;
	// OffscreenCanvas has no display gamma ramp.  Leaving this false makes the
	// renderer apply r_gamma to lightmaps/textures at load, exactly as it does
	// when SDL cannot set a hardware ramp.  Runtime changes are a canvas CSS
	// filter owned by the app.
	glConfig->deviceSupportsGamma = qfalse;

	Com_Printf( "OffscreenCanvas WebGL2 context: %dx%d\n", jka_canvasWidth, jka_canvasHeight );

	window.api = windowDesc ? windowDesc->api : GRAPHICS_API_OPENGL;
	return window;
}

extern "C" void JKA_WIN_Shutdown( void )
{
	if ( jka_glContext ) {
		emscripten_webgl_destroy_context( jka_glContext );
		jka_glContext = 0;
	}
}

extern "C" void JKA_WIN_Present( window_t *window )
{
	(void)window;

	// WebGL on an OffscreenCanvas is presented by the browser when the worker's
	// current task yields.  The engine main loop is driven by emscripten's
	// setTimeout-backed loop, so every frame ends its own task and no explicit
	// swap or commit is needed.  Keep the swap-interval cvar acknowledged so a
	// later frame does not keep trying to apply it.
	if ( jka_rSwapInterval && jka_rSwapInterval->modified ) {
		jka_rSwapInterval->modified = qfalse;
	}
}

extern "C" void JKA_WIN_SetGamma( glconfig_t *glConfig, byte red[256], byte green[256], byte blue[256] )
{
	(void)glConfig;
	(void)red;
	(void)green;
	(void)blue;
	// deviceSupportsGamma is false, so the renderer never calls this in the
	// worker path.  Nothing to program on an OffscreenCanvas.
}

extern "C" void *JKA_WIN_GL_GetProcAddress( const char *proc )
{
	void *function;

	if ( !proc || !proc[0] ) {
		return NULL;
	}

	function = emscripten_webgl2_get_proc_address( proc );
	if ( function ) {
		return function;
	}
	function = emscripten_webgl_get_proc_address( proc );
	if ( function ) {
		return function;
	}

	// The desktop GL names the renderer asks for do not all exist in GLES3.
	// Emscripten's WebGL library only knows the core names, so map the aliases
	// the renderer still queries.
	if ( !Q_stricmp( proc, "glActiveTextureARB" ) ) {
		return emscripten_webgl2_get_proc_address( "glActiveTexture" );
	}
	if ( !Q_stricmp( proc, "glClientActiveTextureARB" ) ) {
		return emscripten_webgl2_get_proc_address( "glClientActiveTexture" );
	}

	return NULL;
}

extern "C" qboolean JKA_WIN_GL_ExtensionSupported( const char *extension )
{
	// emscripten_webgl_get_supported_extensions() returns a newly allocated
	// string, so this helper owns and frees it.
	char *extensions;
	size_t length;
	const char *cursor;
	qboolean supported = qfalse;

	if ( !extension || !extension[0] ) {
		return qfalse;
	}
	extensions = emscripten_webgl_get_supported_extensions();
	if ( !extensions || !extensions[0] ) {
		free( extensions );
		return qfalse;
	}

	length = strlen( extension );
	cursor = extensions;
	while ( ( cursor = Q_stristr( cursor, extension ) ) != NULL ) {
		if ( ( cursor == extensions || cursor[-1] == ' ' ) && ( cursor[length] == ' ' || cursor[length] == '\0' ) ) {
			supported = qtrue;
			break;
		}
		cursor += length;
	}
	free( extensions );
	return supported;
}
