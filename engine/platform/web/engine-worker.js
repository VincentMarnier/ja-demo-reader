/*
 * M9 Phase 3 spike worker.  Classic worker on purpose: the non-modularized
 * Emscripten glue defines a global Module, which we configure before
 * importScripts().  The production app uses the same module shape from
 * app/src/engine/engine.worker.ts.
 */
'use strict';

var ENGINE_ARGS = [
  '+set', 'cl_renderer', 'rd-rend2',
  '+set', 'fs_basepath', '/jka',
  '+set', 'fs_homepath', '/userdata',
  '+set', 'cl_allowDownload', '0',
  '+set', 's_initsound', '0',
  '+set', 'com_bootlogo', '0',
  '+set', 'r_fullscreen', '0',
  '+set', 'r_mode', '4',
  '+set', 'r_hdr', '0',
  '+set', 'r_cubeMapping', '0',
  '+set', 'r_ssao', '0',
  '+set', 'cg_shadows', '0',
  '+set', 'r_ext_compressed_textures', '0',
  '+set', 'com_maxfps', '60',
  '+set', 'logfile', '0'
];

var logs = [];
var busy = false;
var ready = false;
var startedDemo = false;
var demoName = '';

self.alert = function (message) {
  post('ALERT ' + message);
};

function post(line) {
  logs.push(line);
  if (logs.length > 5000) {
    logs.splice(0, logs.length - 5000);
  }
  self.postMessage({ type: 'log', line: String(line) });
}

function state(text, cls) {
  self.postMessage({ type: 'state', text: text, cls: cls || '' });
}

self.onerror = function (message, source, lineno, colno, error) {
  post('WORKER ERROR ' + message + ' @ ' + source + ':' + lineno + ':' + colno +
    (error && error.stack ? '\n' + error.stack : ''));
  return false;
};
self.addEventListener('unhandledrejection', function (event) {
  var reason = event.reason;
  post('WORKER REJECT ' + (reason && reason.stack ? reason.stack : String(reason)));
});

function describeStatus(status) {
  return 'ready=' + status.ready + ' state=' + status.state + ' demo=' + status.demo +
    ' map=' + (status.map || '-') + ' t=' + status.serverTime + ' ended=' + status.ended;
}

function poll() {
  if (!ready || busy) {
    return;
  }
  try {
    if (!self.__jkaWorkerMode) {
      Module.ccall('JKA_SetWorkerMode', null, ['number'], [1]);
      self.__jkaWorkerMode = true;
    }
    var raw = Module.ccall('JKA_StatusJson', 'string', [], []);
    var status = JSON.parse(raw);
    if (status.ready === 1) {
      state('engine ready — ' + describeStatus(status), 'pass');
      if (demoName && !startedDemo) {
        startedDemo = true;
        busy = true;
        post('WORKER play ' + demoName);
        Module.ccall('JKA_PlayDemo', null, ['string'], [demoName], { async: true })
          .then(function () {
            busy = false;
            post('WORKER play returned');
          })
          .catch(function (error) {
            busy = false;
            state('play failed: ' + error, 'fail');
          });
      }
    } else {
      state('booting — ' + describeStatus(status));
    }
  } catch (error) {
    state('status failed: ' + error, 'fail');
  }
}

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'boot') {
    return;
  }

  var files = data.files || [];
  var pk3s = [];
  var demoFile = null;
  for (var i = 0; i < files.length; i++) {
    if (/\.pk3$/i.test(files[i].name)) {
      // WORKERFS `files` wants the File objects themselves.
      pk3s.push(files[i]);
    } else if (/\.dm_26$/i.test(files[i].name)) {
      demoFile = files[i];
    }
  }

  var Module = {
    arguments: ENGINE_ARGS,
    canvas: data.canvas,
    locateFile: function (path) { return data.base + path; },
    print: function (line) { post(line); },
    printErr: function (line) { post('ERR ' + line); },
    onAbort: function (what) { state('engine abort: ' + what, 'fail'); post('ABORT ' + what); },
    onRuntimeInitialized: function () {
      // Do not call into wasm synchronously here: main() has not started yet
      // and an immediate ccall can leave the runtime stuck.  The first poll
      // runs from a timer, after main() has begun.
      ready = true;
      post('WORKER runtime initialized');
      setTimeout(poll, 250);
      setInterval(poll, 500);
    },
    preRun: [function () {
      try {
        FS.mkdirTree('/jka/base');
        FS.mkdirTree('/userdata');
        FS.mkdirTree('/userdata/base');
        FS.mkdirTree('/userdata/base/demos');
      } catch (error) {
        state('mkdir failed: ' + error, 'fail');
        throw error;
      }

      // WORKERFS keeps the PK3 bytes in the source File objects (disk-backed,
      // read through FileReaderSync in this worker) instead of copying them
      // into the wasm heap.
      if (pk3s.length) {
        FS.mount(FS.filesystems.WORKERFS, { files: pk3s }, '/jka/base');
        post('WORKERFS mounted ' + pk3s.length + ' PK3s at /jka/base');
      } else {
        // Always exercise WORKERFS, even with no retail assets supplied.
        var fixture = new Blob(['seta com_maxfps 60\n'], { type: 'text/plain' });
        FS.mount(FS.filesystems.WORKERFS, { blobs: [{ name: 'mpdefault.cfg', data: fixture }] }, '/jka/base');
        post('WORKERFS mounted fixture at /jka/base');
      }

      try {
        if (pk3s.length) {
          // Do not read a whole PK3 into memory; a node lookup plus its size
          // proves WORKERFS resolved the File.
          var node = FS.lookupPath('/jka/base/' + pk3s[0].name).node;
          post('WORKERFS stat ' + pk3s[0].name + ' bytes=' + node.size);
          // Do not create mpdefault.cfg in /userdata/base: it would shadow
          // the real file inside assets2.pk3 (the homepath is searched first).
        } else {
          var fixtureText = FS.readFile('/jka/base/mpdefault.cfg', { encoding: 'utf8' });
          post('WORKERFS read mpdefault.cfg bytes=' + fixtureText.length);
        }
        state('WORKERFS mount verified — booting the engine');
      } catch (error) {
        state('WORKERFS verify failed: ' + error, 'fail');
      }

      if (demoFile) {
        var name = demoFile.name.replace(/\.dm_26$/i, '');
        demoName = name;
        // The File is available synchronously in the worker; writeFile copies
        // it into the writable homepath (MEMFS), never into /jka/base.
        var reader = new FileReaderSync();
        var bytes = new Uint8Array(reader.readAsArrayBuffer(demoFile));
        FS.writeFile('/userdata/base/demos/' + demoFile.name, bytes);
        post('demo written to /userdata/base/demos ' + demoFile.name + ' bytes=' + bytes.length);
      }
    }]
  };

  self.Module = Module;

  try {
    importScripts(data.base + 'openjk.x86.js');
  } catch (error) {
    state('engine script failed: ' + error, 'fail');
    post('IMPORT FAILED ' + error);
    return;
  }
};
