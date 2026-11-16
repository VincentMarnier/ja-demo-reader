import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AssetSelection, DemoInfo, DemoStatus, FreeCamPose, LocalFile, Phase, ScoreboardData, StageProgress, ValidationResult } from './types';
import { CA_ACTIVE } from './types';
import { validateDemoFile, validateSelection } from './fs/validate';
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
import { ScoreboardPanel } from './components/ScoreboardPanel';
import { SettingsPanel } from './components/SettingsPanel';
import type { AppSettings } from './settings';
import { loadSettings, saveSettings } from './settings';

type WizardStep = 'assets' | 'demo' | 'map';

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function demoBase(name: string): string {
  return name.replace(/\.dm_26$/i, '');
}

export default function App() {
  const [step, setStep] = useState<WizardStep>('assets');
  const [assetSelection, setAssetSelection] = useState<AssetSelection | null>(null);
  const [assetValidation, setAssetValidation] = useState<ValidationResult | null>(null);
  const [demoFile, setDemoFile] = useState<LocalFile | null>(null);
  const [demoWarning, setDemoWarning] = useState<string | null>(null);
  const [mapName, setMapName] = useState('');
  const [mapMissing, setMapMissing] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [phase, setPhase] = useState<Phase>('launcher');
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [demoStart, setDemoStart] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [scoreboard, setScoreboard] = useState<ScoreboardData | null>(null);
  const [demoInfo, setDemoInfo] = useState<DemoInfo | null>(null);
  const [freeCam, setFreeCam] = useState(false);
  const [followClient, setFollowClient] = useState<number | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineHost | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const demoInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const logCursorRef = useRef(0);
  const playbackRequestedRef = useRef(false);
  const freeCamPoseRef = useRef<FreeCamPose | null>(null);

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

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const handler = () => setPointerLocked(document.pointerLockElement === stageRef.current);
    document.addEventListener('pointerlockchange', handler);
    return () => document.removeEventListener('pointerlockchange', handler);
  }, []);

  useEffect(() => {
    if ((!freeCam || phase !== 'playing' || showSettings) && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [freeCam, phase, showSettings]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCvar('cg_fov', String(settings.cgFov));
  }, [settings.cgFov, phase]);

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'paused' && phase !== 'ended') return;
    const tick = () => {
      const data = engineRef.current?.getScoreboard();
      if (data) setScoreboard(data);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!freeCam || phase !== 'playing' || showSettings) return;
    const engine = engineRef.current;
    if (!engine) return;

    const keys = settings.freeCamKeys;
    const codes = new Set(Object.values(keys));
    const pressed = new Set<string>();

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (codes.has(event.code)) {
        pressed.add(event.code);
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressed.delete(event.code);
    };
    const clearKeys = () => pressed.clear();
    const mouseDelta = { x: 0, y: 0 };
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== stageRef.current) return;
      mouseDelta.x += event.movementX;
      mouseDelta.y += event.movementY;
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', clearKeys);
    document.addEventListener('mousemove', onMouseMove);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const pose = freeCamPoseRef.current;
      if (!pose) {
        raf = requestAnimationFrame(tick);
        return;
      }

      let yaw = pose.yaw;
      let pitch = pose.pitch;
      const lookSpeed = 100;
      const moveSpeed = 350;
      const riseSpeed = 220;

      if (pressed.has(keys.lookLeft)) yaw += lookSpeed * dt;
      if (pressed.has(keys.lookRight)) yaw -= lookSpeed * dt;
      if (pressed.has(keys.lookUp)) pitch -= lookSpeed * dt;
      if (pressed.has(keys.lookDown)) pitch += lookSpeed * dt;
      yaw -= mouseDelta.x * 0.12;
      pitch += mouseDelta.y * 0.12;
      mouseDelta.x = 0;
      mouseDelta.y = 0;
      pitch = Math.max(-89, Math.min(89, pitch));

      const yawRad = (yaw * Math.PI) / 180;
      const pitchRad = (pitch * Math.PI) / 180;
      const cp = Math.cos(pitchRad);
      const sp = Math.sin(pitchRad);
      const cy = Math.cos(yawRad);
      const sy = Math.sin(yawRad);
      const forward = { x: cp * cy, y: cp * sy, z: -sp };
      const right = { x: sy, y: -cy, z: 0 };

      let { x, y, z } = pose;
      if (pressed.has(keys.forward)) {
        x += forward.x * moveSpeed * dt;
        y += forward.y * moveSpeed * dt;
        z += forward.z * moveSpeed * dt;
      }
      if (pressed.has(keys.back)) {
        x -= forward.x * moveSpeed * dt;
        y -= forward.y * moveSpeed * dt;
        z -= forward.z * moveSpeed * dt;
      }
      if (pressed.has(keys.right)) {
        x += right.x * moveSpeed * dt;
        y += right.y * moveSpeed * dt;
      }
      if (pressed.has(keys.left)) {
        x -= right.x * moveSpeed * dt;
        y -= right.y * moveSpeed * dt;
      }
      if (pressed.has(keys.up)) z += riseSpeed * dt;
      if (pressed.has(keys.down)) z -= riseSpeed * dt;

      const next = { x, y, z, pitch, yaw, roll: 0 };
      freeCamPoseRef.current = next;
      engine.setFreeCamPose(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [freeCam, phase, showSettings, settings.freeCamKeys]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => ({
      ...prev,
      ...patch,
      freeCamKeys: patch.freeCamKeys ?? prev.freeCamKeys
    }));
  }, []);

  const captureMouse = useCallback(() => {
    const stage = stageRef.current;
    if (!stage?.requestPointerLock) return;
    const result = stage.requestPointerLock();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => undefined);
    }
  }, []);

  const toggleFreeCam = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (freeCam) {
      engine.disableFreeCam();
      if (document.pointerLockElement) document.exitPointerLock();
      setFreeCam(false);
      return;
    }
    const pose = engine.enableFreeCam();
    if (!pose) return;
    freeCamPoseRef.current = pose;
    setFollowClient(null);
    setFreeCam(true);
    captureMouse();
  }, [freeCam, captureMouse]);

  const followPlayer = useCallback((clientNum: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (freeCam) {
      engine.disableFreeCam();
      setFreeCam(false);
    }
    engine.followClient(clientNum);
    setFollowClient(clientNum);
  }, [freeCam]);

  const demoCamera = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (freeCam) {
      engine.disableFreeCam();
      setFreeCam(false);
    }
    engine.followClient(-1);
    setFollowClient(null);
  }, [freeCam]);

  const applyAssets = useCallback(async (next: AssetSelection, persistHandle?: FileSystemDirectoryHandle) => {
    setChecking(true);
    setError(null);
    try {
      const result = await validateSelection(next, false);
      setAssetSelection(next);
      setAssetValidation(result);
      setDemoFile(result.demos[0] ?? null);
      setDemoWarning(null);
      setMapName('');
      setMapMissing(false);
      setMapError(null);
      setDemoInfo(null);
      if (result.errors.length === 0) {
        setStep('demo');
      } else {
        setStep('assets');
      }
      if (persistHandle) {
        setSavedHandle(persistHandle);
        saveDirectoryHandle(persistHandle).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      setChecking(false);
    }
  }, []);

  const handlePickAssets = useCallback(async () => {
    try {
      const picked = await pickGameData();
      if (picked) await applyAssets(picked.selection, picked.directory);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [applyAssets]);

  const handleSaved = useCallback(async () => {
    if (!savedHandle) return;
    try {
      if (!(await requestHandlePermission(savedHandle))) {
        setError('Permission for the previously selected folder was denied. Select it again.');
        setPhase('error');
        return;
      }
      await applyAssets(await selectionFromDirectory(savedHandle), savedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [savedHandle, applyAssets]);

  const handleAssetsFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      void applyAssets(selectionFromFileList(files));
      event.target.value = '';
    },
    [applyAssets]
  );

  const selectDemo = useCallback(
    async (file: LocalFile | null) => {
      setDemoFile(file);
      setDemoWarning(null);
      setMapName('');
      setMapMissing(false);
      setMapError(null);
      setDemoInfo(null);
      if (file) {
        const warning = await validateDemoFile(file.file);
        setDemoWarning(warning);
      }
    },
    []
  );

  const handleDemoSelect = useCallback(
    async (name: string) => {
      const file = assetSelection?.demos.find(d => d.name === name) ?? null;
      void selectDemo(file);
      // Switching demos while the player is open must go back through the
      // map check: the new demo may need a different map PK3.
      if (engineRef.current && (phase === 'playing' || phase === 'paused' || phase === 'ended')) {
        engineRef.current.disableFreeCam();
        engineRef.current.followClient(-1);
        setFreeCam(false);
        setFollowClient(null);
        setScoreboard(null);
        setPhase('stopping');
        await engineRef.current.stopDemo();
        playbackRequestedRef.current = false;
        setPaused(false);
        setDemoStart(null);
        setPhase('launcher');
        setStep('demo');
      }
    },
    [assetSelection, selectDemo, phase]
  );

  const handleDemoFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      void selectDemo({ name: file.name, file });
      event.target.value = '';
    },
    [selectDemo]
  );

  const checkMap = useCallback(async () => {
    if (!assetSelection || !demoFile || !canvasRef.current) return;
    setChecking(true);
    setMapError(null);
    setError(null);

    let engine = engineRef.current;
    if (!engine) {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress({ loaded: 0, total: 0, current: '' });
      setPhase('staging');

      const created = new EngineHost({
        onLog: () => undefined,
        onProgress: next => {
          setProgress(next);
          setPhase(next.total > 0 && next.loaded >= next.total ? 'booting' : 'staging');
        },
        onStatus: next => {
          setStatus(next);
          if (playbackRequestedRef.current && next.state === CA_ACTIVE && next.demo === 1) {
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
      engineRef.current = created;
      engine = created;

      // Stage only the four validated retail PK3s plus the chosen demo.
      // Extra PK3s in the folder (custom maps and mods) are not loaded unless
      // the map step asks for them.
      const baseAssets = assetValidation?.assets ?? [];
      const files: LocalFile[] = [...baseAssets, demoFile];

      try {
        await created.boot({ canvas: canvasRef.current, files, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) setError('Staging cancelled.');
        else setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        setChecking(false);
        return;
      }
    }

    setPhase('launcher');
    const name = demoBase(demoFile.name);
    const map = engine.parseDemoMap(name);
    if (!map) {
      setMapError('The demo did not expose a mapname in its first gamestate. The file may be truncated or not protocol 26.');
      setMapName('');
      setMapMissing(false);
      setStep('map');
      setChecking(false);
      return;
    }
    const present = engine.hasMap(map);
    setMapName(map);
    setMapMissing(!present);
    setStep('map');
    setDemoInfo(null);
    const info = await engine.demoInfo(name);
    setDemoInfo(info);
    setChecking(false);

    if (present) {
      // Keep the engine warm; Play starts the actual demo.
      setPhase('launcher');
    }
  }, [assetSelection, assetValidation, demoFile]);

  const startPlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !demoFile || mapMissing) return;
    engine.disableFreeCam();
    engine.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    playbackRequestedRef.current = true;
    setDemoStart(null);
    setPaused(false);
    setPhase('loading');
    try {
      await engine.playDemo(demoBase(demoFile.name));
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [demoFile, mapMissing]);

  const handleMapFileInput = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !engineRef.current || !demoFile) return;
      if (!file.name.toLowerCase().endsWith('.pk3')) {
        setMapError('The map must be supplied as a .pk3 file.');
        return;
      }
      try {
        await engineRef.current.addMapFile(file);
        const map = engineRef.current.parseDemoMap(demoBase(demoFile.name));
        if (!map) {
          setMapError('Could not re-read the demo map after adding the PK3.');
          return;
        }
        setMapName(map);
        const present = engineRef.current.hasMap(map);
        setMapMissing(!present);
        setMapError(present ? null : `maps/${map}.bsp is still missing. Add the map PK3 that contains it.`);
      } catch (err) {
        setMapError(err instanceof Error ? err.message : String(err));
      }
    },
    [demoFile]
  );

  const togglePause = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !paused;
    setPaused(next);
    setPhase(next ? 'paused' : 'playing');
    try {
      await engine.setPaused(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [paused]);

  const restart = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !demoFile) return;
    engine.disableFreeCam();
    engine.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setPaused(false);
    setDemoStart(null);
    setPhase('loading');
    try {
      await engine.playDemo(demoBase(demoFile.name));
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [demoFile]);

  const handleSeek = useCallback(async (positionMs: number) => {
    const engine = engineRef.current;
    if (!engine || !demoFile || !demoInfo) return;
    const maxPosition = Math.max(0, demoInfo.duration - 250);
    const position = Math.max(0, Math.min(maxPosition, Math.round(positionMs)));
    const target = demoInfo.first + position;

    engine.disableFreeCam();
    engine.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setPaused(false);
    playbackRequestedRef.current = true;
    setPhase('seeking');

    try {
      await engine.seekDemo(demoBase(demoFile.name), target);
      setDemoStart(demoInfo.first);
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [demoFile, demoInfo]);

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    engine?.disableFreeCam();
    engine?.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setPhase('stopping');
    try {
      await engine?.stopDemo();
    } catch (error) {
      // The UI should still return to the map step even if the engine call
      // misbehaves; the next Play reuses or reloads the engine.
      console.warn('Could not stop the demo cleanly.', error);
    }
    playbackRequestedRef.current = false;
    setPaused(false);
    setDemoStart(null);
    setPhase('launcher');
    setStep('map');
  }, []);

  const fullscreen = useCallback(() => {
    stageRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const reload = useCallback(() => window.location.reload(), []);

  const mapLabel = mapName || (status?.map ? status.map.replace(/^maps\//, '').replace(/\.bsp$/i, '') : '');
  const elapsed = status && demoStart !== null ? formatTime(status.serverTime - demoStart) : '0:00';
  const demoPosition = demoInfo && status ? Math.max(0, status.serverTime - demoInfo.first) : 0;
  const showWizard = phase === 'launcher' || phase === 'validating';
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
          <button className="ghost" onClick={() => setShowSettings(true)}>Settings</button>
          <button className="ghost" onClick={() => setShowLogs(v => !v)}>
            {showLogs ? 'Hide log' : 'Show log'}
          </button>
          <button className="ghost" onClick={() => engineRef.current?.downloadLogs()} disabled={!engineRef.current}>
            Download log
          </button>
        </div>
      </header>

      <main className="main">
        <div className="play-area">
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} width={800} height={600} className="screen" />

          {showWizard ? (
            <Launcher
              step={step}
              assetSelection={assetSelection}
              assetValidation={assetValidation}
              demoFile={demoFile}
              demoWarning={demoWarning}
              mapName={mapName}
              mapMissing={mapMissing}
              mapError={mapError}
              savedHandle={savedHandle}
              busy={checking}
              onPickAssets={handlePickAssets}
              onSaved={handleSaved}
              onAssetsFileInput={handleAssetsFileInput}
              assetInputRef={assetInputRef}
              demoInputRef={demoInputRef}
              mapInputRef={mapInputRef}
              onDemoSelect={handleDemoSelect}
              onDemoFileInput={handleDemoFileInput}
              onCheckMap={checkMap}
              onMapFileInput={handleMapFileInput}
              onPlay={startPlay}
              onStep={setStep}
            />
          ) : null}

          {phase === 'staging' || phase === 'booting' || phase === 'loading' || phase === 'stopping' || phase === 'seeking' ? (
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
              mapName={mapLabel}
              elapsed={elapsed}
              paused={paused}
              phase={phase}
              scores={scoreboard}
              view={scoreboard?.view ?? null}
              showScores={settings.showScores}
              showTimer={settings.showTimer}
              currentMs={demoPosition}
              durationMs={demoInfo?.duration ?? 0}
              freeCam={freeCam}
              followClient={followClient}
              pointerLocked={pointerLocked}
              onCaptureMouse={captureMouse}
              demoName={demoFile?.name ?? ''}
              demos={assetSelection?.demos ?? []}
              onPause={togglePause}
              onRestart={restart}
              onStop={stop}
              onFullscreen={fullscreen}
              onToggleFreeCam={toggleFreeCam}
              onDemoCamera={demoCamera}
              onSeek={handleSeek}
              onSelectDemo={handleDemoSelect}
              onShowLogs={() => setShowLogs(true)}
            />
          ) : null}
        </div>

        {showPlayer && settings.showScoreboard ? (
          <ScoreboardPanel
            data={scoreboard}
            followClient={followClient}
            onFollow={followPlayer}
            onDemoCamera={demoCamera}
          />
        ) : null}
        </div>
      </main>

      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

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
