/*
===========================================================================
Copyright (C) 2026 jka-demo-player contributors

This file is part of the OpenJK source code.

OpenJK is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License version 2 as
published by the Free Software Foundation.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with OpenJK; if not, see <http://www.gnu.org/licenses/>.
===========================================================================
*/

// M1 boot-only renderer stub.
//
// Purpose: let the Emscripten MP client complete CL_InitRef and run its frame
// loop before the WebGL renderer exists. It implements only the entry points
// touched during boot and while no map/cgame is active. Scene, G2, cinematic
// and cgame entry points are intentionally left NULL: calling one before M2
// must fail loudly rather than silently draw nothing.

#include "qcommon/qcommon.h"
#include "rd-common/tr_public.h"

#include <cstring>

static void Stub_Shutdown( qboolean destroyWindow, qboolean restarting )
{
	(void)destroyWindow;
	(void)restarting;
}

static void Stub_BeginRegistration( glconfig_t *config )
{
	if ( !config )
		return;

	std::memset( config, 0, sizeof( *config ) );
	config->vidWidth = 640;
	config->vidHeight = 480;
	config->colorBits = 24;
	config->depthBits = 24;
	config->stencilBits = 8;
	config->displayFrequency = 60;
	config->isFullscreen = qfalse;
	config->deviceSupportsGamma = qfalse;
	config->textureCompression = TC_NONE;
	config->maxTextureSize = 1024;
	config->maxActiveTextures = 1;
}

static qhandle_t Stub_RegisterModel( const char *name ) { (void)name; return 0; }
static qhandle_t Stub_RegisterServerModel( const char *name ) { (void)name; return 0; }
static qhandle_t Stub_RegisterSkin( const char *name ) { (void)name; return 0; }
static qhandle_t Stub_RegisterServerSkin( const char *name ) { (void)name; return 0; }
static qhandle_t Stub_RegisterShader( const char *name ) { (void)name; return 0; }
static qhandle_t Stub_RegisterShaderNoMip( const char *name ) { (void)name; return 0; }
static const char *Stub_ShaderNameFromIndex( int index ) { (void)index; return ""; }

static void Stub_EndRegistration( void ) {}
static void Stub_ClearScene( void ) {}
static void Stub_RenderScene( const refdef_t *fd ) { (void)fd; }
static void Stub_SetColor( const float *rgba ) { (void)rgba; }

static void Stub_DrawStretchPic( float x, float y, float w, float h,
	float s1, float t1, float s2, float t2, qhandle_t hShader )
{
	(void)x; (void)y; (void)w; (void)h;
	(void)s1; (void)t1; (void)s2; (void)t2; (void)hShader;
}

static void Stub_BeginFrame( stereoFrame_t stereoFrame ) { (void)stereoFrame; }

static void Stub_EndFrame( int *frontEndMsec, int *backEndMsec )
{
	if ( frontEndMsec ) *frontEndMsec = 0;
	if ( backEndMsec ) *backEndMsec = 0;
}

static qhandle_t Stub_RegisterFont( const char *fontName ) { (void)fontName; return 1; }

static int Stub_Font_StrLenPixels( const char *text, const int iFontIndex, const float scale )
{
	(void)iFontIndex;
	if ( !text ) return 0;
	int n = (int)std::strlen( text );
	float s = scale > 0.0f ? scale : 1.0f;
	return (int)( n * 8.0f * s );
}

static int Stub_Font_StrLenChars( const char *text )
{
	return text ? (int)std::strlen( text ) : 0;
}

static int Stub_Font_HeightPixels( const int iFontIndex, const float scale )
{
	(void)iFontIndex;
	float s = scale > 0.0f ? scale : 1.0f;
	int h = (int)( 8.0f * s );
	return h > 0 ? h : 1;
}

static void Stub_Font_DrawString( int ox, int oy, const char *text, const float *rgba,
	const int setIndex, int iCharLimit, const float scale )
{
	(void)ox; (void)oy; (void)text; (void)rgba;
	(void)setIndex; (void)iCharLimit; (void)scale;
}

static qboolean Stub_Language_IsAsian( void ) { return qfalse; }
static qboolean Stub_Language_UsesSpaces( void ) { return qtrue; }

static unsigned int Stub_AnyLanguage_ReadCharFromString( const char *psText, int *piAdvanceCount,
	qboolean *pbIsTrailingPunctuation )
{
	if ( piAdvanceCount ) *piAdvanceCount = psText && psText[0] ? 1 : 0;
	if ( pbIsTrailingPunctuation ) *pbIsTrailingPunctuation = qfalse;
	return psText ? (unsigned char)psText[0] : 0;
}

static void Stub_RemapShader( const char *oldShader, const char *newShader, const char *offsetTime )
{
	(void)oldShader; (void)newShader; (void)offsetTime;
}

static qboolean Stub_GetEntityToken( char *buffer, int size )
{
	if ( buffer && size > 0 ) buffer[0] = '\0';
	return qfalse;
}

static qboolean Stub_inPVS( const vec3_t p1, const vec3_t p2, byte *mask )
{
	(void)p1; (void)p2; (void)mask;
	return qfalse;
}

static void Stub_GetLightStyle( int style, color4ub_t color )
{
	(void)style;
	if ( color ) { color[0] = 255; color[1] = 255; color[2] = 255; color[3] = 255; }
}

static void Stub_SetLightStyle( int style, int color ) { (void)style; (void)color; }

static void Stub_GetRealRes( int *w, int *h )
{
	if ( w ) *w = 640;
	if ( h ) *h = 480;
}

static float Stub_GetDistanceCull( void ) { return 0.0f; }

static void Stub_RegisterMedia_LevelLoadBegin( const char *psMapName, ForceReload_e eForceReload )
{
	(void)psMapName; (void)eForceReload;
}
static void Stub_RegisterMedia_LevelLoadEnd( void ) {}
static int Stub_RegisterMedia_GetLevel( void ) { return 0; }
static qboolean Stub_RegisterImages_LevelLoadEnd( void ) { return qfalse; }
static qboolean Stub_RegisterModels_LevelLoadEnd( qboolean bDeleteEverythingNotUsedThisLevel )
{
	(void)bDeleteEverythingNotUsedThisLevel;
	return qfalse;
}

static void Stub_ModelBounds( qhandle_t model, vec3_t mins, vec3_t maxs )
{
	(void)model;
	if ( mins ) { mins[0] = mins[1] = mins[2] = -8.0f; }
	if ( maxs ) { maxs[0] = maxs[1] = maxs[2] = 8.0f; }
}

extern "C" refexport_t *GetRefAPIStub( int version, refimport_t *rimp )
{
	static refexport_t re;

	(void)rimp;

	if ( version != REF_API_VERSION )
		return NULL;

	std::memset( &re, 0, sizeof( re ) );

	re.Shutdown = Stub_Shutdown;
	re.BeginRegistration = Stub_BeginRegistration;
	re.RegisterModel = Stub_RegisterModel;
	re.RegisterServerModel = Stub_RegisterServerModel;
	re.RegisterSkin = Stub_RegisterSkin;
	re.RegisterServerSkin = Stub_RegisterServerSkin;
	re.RegisterShader = Stub_RegisterShader;
	re.RegisterShaderNoMip = Stub_RegisterShaderNoMip;
	re.ShaderNameFromIndex = Stub_ShaderNameFromIndex;
	re.EndRegistration = Stub_EndRegistration;
	re.ClearScene = Stub_ClearScene;
	re.RenderScene = Stub_RenderScene;
	re.SetColor = Stub_SetColor;
	re.DrawStretchPic = Stub_DrawStretchPic;
	re.BeginFrame = Stub_BeginFrame;
	re.EndFrame = Stub_EndFrame;
	re.RegisterFont = Stub_RegisterFont;
	re.Font_StrLenPixels = Stub_Font_StrLenPixels;
	re.Font_StrLenChars = Stub_Font_StrLenChars;
	re.Font_HeightPixels = Stub_Font_HeightPixels;
	re.Font_DrawString = Stub_Font_DrawString;
	re.Language_IsAsian = Stub_Language_IsAsian;
	re.Language_UsesSpaces = Stub_Language_UsesSpaces;
	re.AnyLanguage_ReadCharFromString = Stub_AnyLanguage_ReadCharFromString;
	re.RemapShader = Stub_RemapShader;
	re.GetEntityToken = Stub_GetEntityToken;
	re.inPVS = Stub_inPVS;
	re.GetLightStyle = Stub_GetLightStyle;
	re.SetLightStyle = Stub_SetLightStyle;
	re.GetRealRes = Stub_GetRealRes;
	re.GetDistanceCull = Stub_GetDistanceCull;
	re.RegisterMedia_LevelLoadBegin = Stub_RegisterMedia_LevelLoadBegin;
	re.RegisterMedia_LevelLoadEnd = Stub_RegisterMedia_LevelLoadEnd;
	re.RegisterMedia_GetLevel = Stub_RegisterMedia_GetLevel;
	re.RegisterImages_LevelLoadEnd = Stub_RegisterImages_LevelLoadEnd;
	re.RegisterModels_LevelLoadEnd = Stub_RegisterModels_LevelLoadEnd;
	re.ModelBounds = Stub_ModelBounds;

	return &re;
}
