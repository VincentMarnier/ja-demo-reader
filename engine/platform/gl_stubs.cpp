/*
===========================================================================
Copyright (C) 2026 jka-demo-player contributors

This file is part of the OpenJK source code.

OpenJK is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License version 2 as
published by the Free Software Foundation.
===========================================================================
*/

// M2 WebGL gaps: Emscripten's LEGACY_GL_EMULATION does not provide display
// lists or glArrayElement. rd-vanilla is forced onto the glDrawElements path
// (r_primitives = 2), so these can be inert; display lists are only used by
// legacy 2D paths that the browser port does not rely on.

#include <GL/gl.h>
#include "qcommon/q_shared.h"

extern "C" {

void glArrayElement( GLint i ) { (void)i; }

void glNewList( GLuint list, GLenum mode ) { (void)list; (void)mode; }
void glEndList( void ) {}
void glCallList( GLuint list ) { (void)list; }
void glDeleteLists( GLuint list, GLsizei range ) { (void)list; (void)range; }
GLuint glGenLists( GLsizei range ) { (void)range; return 0; }

void glPushAttrib( GLbitfield mask ) { (void)mask; }
void glPopAttrib( void ) {}

}
