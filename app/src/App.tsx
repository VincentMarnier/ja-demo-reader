import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AssetSelection, DemoStatus, Phase, StageProgress, ValidationResult } from './types';
import { CA_ACTIVE } from './types';
import { validateSelection } from './fs/validate';
import {
  pickGameData,
  requestHandlePermission,
  selectionFromDirectory,
  selectionFromFileList
} from './fs/sources';
import { loadDirectoryHandle, saveDirectoryHandle } from './fs/handles';
import { EngineHost } from './engine/EngineHost';
import { Launcher } from './components/Launcher';
import { Player } from './components/Player';
import { ProgressOverlay } from './components/ProgressOverlay';
import { ErrorPanel } from './components/ErrorPanel';

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [selection, setSelection] = useState<AssetSelection | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [selectedDemo, setSelectedDemo] = useState('');
  const [phase, setPhase] = useState<Phase>('launcher');
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [demoStart, setDemoStart] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineHost | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logCursorRef = useRef(0);

  useEffect(() => {
    loadDirectoryHandle().then(handle => setSavedHandle(handle));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const all = engine.logText ? engine.logText.split('\n') : [];
      if (all.length !== logCursorRef.current) {
        logCursorRef.current = all.length;
        setLogs(all.slice(-300));
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const applySelection = useCallback(async (next: AssetSelection, persistHandle?: FileSystemDirectoryHandle) => {
    setPhase('validating');
    setError(null);
    try {
      const result = await validateSelection(next);
      setSelection(next);
      setValidation(result);
      setSelectedDemo(result.demos[0]?.name ?? '');
      if (result.errors.length > 0) {
        setError(result.errors.join('\n'));
        setPhase('error');
      } else {
        setPhase('launcher');
      }
      if (persistHandle) {
        setSavedHandle(persistHandle);
        saveDirectoryHandle(persistHandle).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  const handlePick = useCallback(async () => {
    try {
      const picked = await pickGameData();
      if (picked) await applySelection(picked.selection, picked.directory);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [applySelection]);

  const handleSaved = useCallback(async () => {
    if (!savedHandle) return;
    try {
      if (!(await requestHandlePermission(savedHandle))) {
        setError('Permission for the previously selected folder was denied. Select it again.');
        setPhase('error');
        return;
      }
      const next = await selectionFromDirectory(savedHandle);
      await applySelection(next, savedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [savedHandle, applySelection]);

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      const next = selectionFromFileList(files);
      void applySelection(next);
      event.target.value = '';
    },
    [applySelection]
  );

  const startEngine = useCallback(async () => {
    if (!selection || !selectedDemo || !canvasRef.current) return;
    if (engineRef.current) {
      engineRef.current.playDemo(selectedDemo.replace(/\.dm_26$/i, ''));
      setDemoStart(null);
      setPaused(false);
      setPhase('playing');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ loaded: 0, total: 0, current: '' });
    setError(null);
    setPhase('staging');

    const engine = new EngineHost({
      onLog: () => undefined,
      onProgress: next => {
        setProgress(next);
        setPhase(next.total > 0 && next.loaded >= next.total ? 'booting' : 'staging');
      },
      onStatus: next => {
        setStatus(next);
        if (next.state === CA_ACTIVE && next.demo === 1) {
          setDemoStart(prev => prev ?? next.serverTime);
          setPhase(current => (current === 'paused' ? current : 'playing'));
        }
        if (next.ended === 1) {
          setPhase('ended');
          setPaused(false);
        }
      },
      onFatal: message => {
        setError(message);
        setPhase('error');
      }
    });
    engineRef.current = engine;

    try {
      await engine.boot({
        canvas: canvasRef.current,
        files: selection.files,
        signal: controller.signal
      });
      engine.playDemo(selectedDemo.replace(/\.dm_26$/i, ''));
      setDemoStart(null);
      setPaused(false);
      setPhase('playing');
    } catch (err) {
      if (controller.signal.aborted) {
        setError('Staging cancelled.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setPhase('error');
    }
  }, [selection, selectedDemo]);

  const handleSelectDemo = useCallback(
    (name: string) => {
      setSelectedDemo(name);
      if (engineRef.current && (phase === 'playing' || phase === 'paused' || phase === 'ended')) {
        engineRef.current.playDemo(name.replace(/\.dm_26$/i, ''));
        setDemoStart(null);
        setPaused(false);
        setPhase('playing');
      }
    },
    [phase]
  );

  const togglePause = useCallback(() => {
    if (!engineRef.current) return;
    if (paused) {
      engineRef.current.setPaused(false);
      setPaused(false);
      setPhase('playing');
    } else {
      engineRef.current.setPaused(true);
      setPaused(true);
      setPhase('paused');
    }
  }, [paused]);

  const restart = useCallback(() => {
    if (!engineRef.current || !selectedDemo) return;
    engineRef.current.playDemo(selectedDemo.replace(/\.dm_26$/i, ''));
    setPaused(false);
    setDemoStart(null);
    setPhase('playing');
  }, [selectedDemo]);

  const stop = useCallback(() => {
    engineRef.current?.stopDemo();
    setPaused(false);
    setDemoStart(null);
    setPhase('ready');
  }, []);

  const fullscreen = useCallback(() => {
    stageRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const reload = useCallback(() => window.location.reload(), []);

  const mapName = status?.map ? status.map.replace(/^maps\//, '').replace(/\.bsp$/i, '') : '';
  const elapsed = status && demoStart !== null ? formatTime(status.serverTime - demoStart) : '0:00';
  const showLauncher = phase === 'launcher' || phase === 'validating';
  const showPlayer = phase === 'playing' || phase === 'paused' || phase === 'ended';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">JKA</span>
          <div>
            <strong>Demo Player</strong>
            <span className="sub">local · offline · no upload</span>
          </div>
        </div>
        <div className="top-actions">
          <button className="ghost" onClick={() => setShowLogs(v => !v)}>
            {showLogs ? 'Hide log' : 'Show log'}
          </button>
          <button className="ghost" onClick={() => engineRef.current?.downloadLogs()} disabled={!engineRef.current}>
            Download log
          </button>
        </div>
      </header>

      <main className="main">
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} width={800} height={600} className="screen" />

          {showLauncher ? (
            <Launcher
              selection={selection}
              validation={validation}
              selectedDemo={selectedDemo}
              savedHandle={savedHandle}
              busy={phase === 'validating'}
              onPick={handlePick}
              onSaved={handleSaved}
              onFileInput={handleFileInput}
              fileInputRef={fileInputRef}
              onDemoChange={handleSelectDemo}
              onPlay={startEngine}
            />
          ) : null}

          {phase === 'staging' || phase === 'booting' ? (
            <ProgressOverlay
              progress={progress}
              phase={phase}
              onCancel={() => {
                abortRef.current?.abort();
                reload();
              }}
            />
          ) : null}

          {phase === 'error' ? (
            <ErrorPanel message={error ?? 'Unknown error.'} logs={logs} onReload={reload} onBack={reload} />
          ) : null}

          {showPlayer ? (
            <Player
              status={status}
              mapName={mapName}
              elapsed={elapsed}
              paused={paused}
              phase={phase}
              demoName={selectedDemo}
              demos={selection?.demos ?? []}
              onPause={togglePause}
              onRestart={restart}
              onStop={stop}
              onFullscreen={fullscreen}
              onSelectDemo={handleSelectDemo}
              onShowLogs={() => setShowLogs(true)}
            />
          ) : null}

          {phase === 'ready' ? (
            <div className="ready-layer">
              <div className="panel compact">
                <h2>Engine ready</h2>
                <p className="muted">Assets are staged. Start the demo when you are ready.</p>
                <button className="primary" onClick={startEngine}>Play {selectedDemo}</button>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {showLogs ? (
        <aside className="log-panel">
          <div className="log-head">
            <strong>Engine log</strong>
            <button className="ghost" onClick={() => setShowLogs(false)}>Close</button>
          </div>
          <pre>{logs.length ? logs.join('\n') : 'No engine output yet.'}</pre>
        </aside>
      ) : null}
    </div>
  );
}

