import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import type { AssetSelection, DemoInfo, DemoStatus, DemoSummary, FreeCamPose, KillMarker, LocalFile, Phase, RadarData, ScoreboardData, StageProgress, ValidationResult } from './types';
import { CA_ACTIVE } from './types';
import { validateDemoFile, validateSelection } from './fs/validate';
import {
  pickGameData,
  requestHandlePermission,
  selectionFromDirectory,
  selectionFromFileList
} from './fs/sources';
import { loadDirectoryHandle, saveDirectoryHandle } from './fs/handles';
import { loadDemoSummary, saveDemoSummary, clearDemoSummaries } from './fs/demoCache';
import { assetSetKey } from './fs/signature';
import { clearLegacyAssetCache } from './fs/assetCache';
import { clearMapImageCache, loadMapImage } from './map/mapImage';
import { chooseGame, mergeScoreboard } from './summary';
import { formatTime } from './format';
import { createEngineHost, resolveRenderSize, WorkerUnsupportedError } from './engine/host';
import type { EngineHostApi, EngineMode } from './engine/host';
import { Launcher } from './components/Launcher';
import { KillFeed } from './components/KillFeed';
import { Player } from './components/Player';
import { ProgressOverlay } from './components/ProgressOverlay';
import { ErrorPanel } from './components/ErrorPanel';
import { ScoreboardPanel } from './components/ScoreboardPanel';
import { SettingsPanel } from './components/SettingsPanel';
import type { AppSettings, PipCorner } from './settings';
import { loadSettings, saveSettings } from './settings';
import { CornerDemo } from './components/CornerDemo';
import { collectMissingAssets } from './missingAssets';
import type { MissingAsset } from './missingAssets';
import { MissingAssetsPanel } from './components/MissingAssetsPanel';

type WizardStep = 'assets' | 'demo' | 'map';

function demoBase(name: string): string {
  return name.replace(/\.dm_26$/i, '');
}

function pk3Files(files: LocalFile[]): LocalFile[] {
  return files.filter(file => file.name.toLowerCase().endsWith('.pk3'));
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
  const [addedPk3s, setAddedPk3s] = useState<string[]>([]);
  const [addedPk3Files, setAddedPk3Files] = useState<File[]>([]);
  const [addingPk3s, setAddingPk3s] = useState(false);
  const [checking, setChecking] = useState(false);

  const [phase, setPhase] = useState<Phase>('launcher');
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [missingAssets, setMissingAssets] = useState<MissingAsset[]>([]);
  const [showMissingAssets, setShowMissingAssets] = useState(false);
  const [paused, setPaused] = useState(false);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  // The corner player lives while the map is enlarged; its live size/corner
  // avoid touching persisted settings on every pointer move.
  const [pip, setPip] = useState(() => ({
    corner: settings.pipCorner,
    width: settings.pipWidth
  }));
  const [showSettings, setShowSettings] = useState(false);
  const [scoreboard, setScoreboard] = useState<ScoreboardData | null>(null);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [demoInfo, setDemoInfo] = useState<DemoInfo | null>(null);
  const [demoSummary, setDemoSummary] = useState<DemoSummary | null>(null);
  const [engineMode, setEngineMode] = useState<EngineMode | null>(null);
  const [engineActive, setEngineActive] = useState(false);
  const [preparingDemo, setPreparingDemo] = useState<string | null>(null);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const [enginePreparing, setEnginePreparing] = useState(false);
  const [engineProgress, setEngineProgress] = useState<StageProgress | null>(null);
  const [freeCam, setFreeCam] = useState(false);
  const [followClient, setFollowClient] = useState<number | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);
  // The windowed stage is 4:3 and the fullscreen stage is the screen, so the
  // cgame needs the displayed aspect to keep the stretched canvas square.
  const [stageAspect, setStageAspect] = useState(4 / 3);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EngineHostApi | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const demoInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const logCursorRef = useRef(0);
  const playbackRequestedRef = useRef(false);
  const freeCamPoseRef = useRef<FreeCamPose | null>(null);
  const demoSummaryRef = useRef<DemoSummary | null>(null);
  const statusRef = useRef<DemoStatus | null>(null);
  const playbackActionRef = useRef(false);
  const bootPromiseRef = useRef<Promise<EngineHostApi> | null>(null);
  const bootForegroundRef = useRef(false);
  const bootedAssetKeyRef = useRef<string | null>(null);
  const bootGammaRef = useRef(1);
  const preparePromiseRef = useRef<Promise<boolean> | null>(null);
  const preparedDemoRef = useRef<string | null>(null);
  // The scan builds the in-memory seek keyframes.  After a demo/engine change
  // a cached summary alone is not enough for a warm seek.
  const keyframesReadyRef = useRef(false);
  // Missing content is accumulated per map load from the engine log, not
  // re-derived from the short log-panel buffer, so a warning keeps its place
  // after later lines push it out of the visible tail.
  const missingAssetsRef = useRef<MissingAsset[]>([]);
  const missingAssetKeysRef = useRef<Set<string>>(new Set());

  const resetMissingAssets = useCallback(() => {
    missingAssetsRef.current = [];
    missingAssetKeysRef.current = new Set();
    setMissingAssets([]);
    setShowMissingAssets(false);
  }, []);

  useEffect(() => {
    loadDirectoryHandle().then(handle => setSavedHandle(handle));
    // M9 Phase 3: the OPFS asset copy is gone.  Remove the legacy tree once so
    // existing users recover the ~1.14 GB it held.
    void clearLegacyAssetCache().then(removed => {
      if (removed) console.info('Removed the legacy OPFS asset cache.');
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const all = engine.logText ? engine.logText.split('\n') : [];
      if (all.length === logCursorRef.current) return;
      const start = all.length >= logCursorRef.current ? logCursorRef.current : 0;
      const fresh = all.slice(start);
      logCursorRef.current = all.length;
      setLogs(all.slice(-300));

      if (fresh.length) {
        const found = collectMissingAssets(fresh);
        let added = false;
        for (const asset of found) {
          if (missingAssetKeysRef.current.has(asset.key)) continue;
          missingAssetKeysRef.current.add(asset.key);
          missingAssetsRef.current.push(asset);
          added = true;
        }
        if (added) setMissingAssets([...missingAssetsRef.current]);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    demoSummaryRef.current = demoSummary;
  }, [demoSummary]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const handler = () => setPointerLocked(document.pointerLockElement === stageRef.current);
    document.addEventListener('pointerlockchange', handler);
    return () => document.removeEventListener('pointerlockchange', handler);
  }, []);

  // In fullscreen only the stage is painted, so the side scoreboard moves
  // inside it as an overlay.
  useEffect(() => {
    const handler = () => setStageFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // The canvas always fills the stage, so the stage's CSS aspect is the real
  // display aspect.  Feed it to cgame: with cg_fovAspectAdjust=1 the engine
  // widens the horizontal FOV instead of showing a stretched 4:3 picture.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return;
      const aspect = rect.width / rect.height;
      setStageAspect(aspect);
      engineRef.current?.setCvar('cg_fovAspect', aspect.toFixed(5));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    document.addEventListener('fullscreenchange', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('fullscreenchange', schedule);
    };
  }, [phase, engineActive]);

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
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCvar('timescale', String(settings.playbackSpeed));
  }, [settings.playbackSpeed, phase]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCvar('s_volume', settings.volumeEffects.toFixed(2));
    engine.setCvar('s_musicvolume', settings.volumeMusic.toFixed(2));
    engine.setCvar('s_volumeVoice', settings.volumeVoice.toFixed(2));
  }, [settings.volumeEffects, settings.volumeMusic, settings.volumeVoice, phase]);

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'paused' && phase !== 'ended') return;
    let cancelled = false;
    const tick = () => {
      const engine = engineRef.current;
      if (!engine) return;
      void engine.getScoreboard().then(data => {
        if (cancelled || !data) return;
        setScoreboard(mergeScoreboard(data, demoSummaryRef.current, statusRef.current?.serverTime ?? 0));
      });
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'paused' && phase !== 'ended') return;
    let cancelled = false;
    const tick = () => {
      const engine = engineRef.current;
      if (!engine) return;
      void engine.getRadar().then(data => {
        if (cancelled || !data) return;
        setRadar(data);
      });
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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

  const toggleFreeCam = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (freeCam) {
      engine.disableFreeCam();
      if (document.pointerLockElement) document.exitPointerLock();
      setFreeCam(false);
      return;
    }
    const pose = await engine.enableFreeCam();
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

  // The minimap asks for recorded positions around the live time so it can
  // draw the past and future trails; the scan owns the full trajectory.
  const loadTrajectory = useCallback(async (from: number, to: number) => {
    const engine = engineRef.current;
    return engine ? engine.getTrajectory(from, to) : null;
  }, []);

  const resizePip = useCallback((width: number) => {
    setPip(current => (current.width === width ? current : { ...current, width }));
  }, []);

  const commitPip = useCallback((corner: PipCorner, width: number) => {
    setPip({ corner, width });
    setSettings(current => ({ ...current, pipCorner: corner, pipWidth: width }));
  }, []);

  const expandMap = useCallback(() => {
    setSettings(current => ({ ...current, showMinimap: true, mapExpanded: true }));
  }, []);

  const expandDemo = useCallback(() => {
    setSettings(current => ({ ...current, mapExpanded: false }));
  }, []);

  // Mount the whole base selection, not just the four retail assets: a
  // GameData/base folder usually also holds the demo's map PK3 and the model,
  // texture and shader PK3s a community map borrows from.  Mounting them all
  // lets the engine's own pak search path resolve both the map and its
  // dependencies, instead of asking the user to re-add a file that is already
  // in base/.
  const bootPk3Files = useMemo<LocalFile[]>(
    () => pk3Files(assetSelection?.files ?? []),
    [assetSelection]
  );

  const bootEngine = useCallback(async (files: LocalFile[], foreground: boolean): Promise<EngineHostApi> => {
    if (bootPromiseRef.current) {
      if (foreground) {
        bootForegroundRef.current = true;
        setPhase(current => (current === 'playing' || current === 'paused' ? current : 'booting'));
      }
      return bootPromiseRef.current;
    }
    if (engineRef.current) return engineRef.current;

    const canvas = canvasRef.current;
    if (!canvas) throw new Error('The engine canvas is not ready.');

    // The render target follows the screen rather than the 4:3 stage.  The
    // canvas is stretched over the stage, and cg_fovAspect corrects the
    // projection, so fullscreen fills the screen at its own aspect.
    const renderSize = resolveRenderSize();
    canvas.width = renderSize.width;
    canvas.height = renderSize.height;

    const controller = new AbortController();
    abortRef.current = controller;
    bootForegroundRef.current = foreground;
    setProgress({ loaded: 0, total: 0, current: '' });
    setEngineProgress({ loaded: 0, total: 0, current: '' });
    setEnginePreparing(!foreground);
    if (foreground) setPhase('staging');

    const callbacks = {
      onLog: () => undefined,
      onProgress: (next: StageProgress) => {
        setProgress(next);
        setEngineProgress(next);
        if (bootForegroundRef.current) {
          setPhase(next.total > 0 && next.loaded >= next.total ? 'booting' : 'staging');
        } else {
          setEnginePreparing(true);
        }
      },
      onStatus: (next: DemoStatus) => {
        statusRef.current = next;
        setStatus(next);
        if (playbackRequestedRef.current && next.state === CA_ACTIVE && next.demo === 1) {
          setPhase(current => (current === 'paused' ? current : 'playing'));
        }
        if (next.ended === 1 && playbackRequestedRef.current) {
          setPhase('ended');
          setPaused(false);
        }
      },
      onFatal: (message: string) => {
        setError(message);
        setPhase('error');
        setEngineActive(false);
      }
    };

    bootedAssetKeyRef.current = assetSetKey(pk3Files(files));

    const bootHost = async (host: EngineHostApi): Promise<EngineHostApi> => {
      engineRef.current = host;
      setEngineMode(host.mode);
      try {
        await host.boot({
          canvas,
          files,
          signal: controller.signal,
          texturePicmip: settings.texturePicmip,
          textureMipmaps: settings.textureMipmaps,
          renderWidth: renderSize.width,
          renderHeight: renderSize.height
        });
        setEngineActive(true);
        return host;
      } catch (error) {
        // The worker preflight runs before transferControlToOffscreen, so a
        // missing worker/script can still fall back in this page.
        if (host.mode === 'worker' && error instanceof WorkerUnsupportedError) {
          console.warn('Worker engine unavailable; using the main-thread fallback.', error.message);
          host.destroy();
          engineRef.current = null;
          const fallback = createEngineHost(callbacks, 'main-thread');
          return bootHost(fallback);
        }
        throw error;
      }
    };

    const promise = bootHost(createEngineHost(callbacks))
      .then(created => {
        bootGammaRef.current = settings.rGamma;
        created.setCvar('cg_fov', String(settings.cgFov));
        created.setCvar('r_gamma', String(settings.rGamma));
        created.setCvar('timescale', String(settings.playbackSpeed));
        created.setCvar('s_volume', settings.volumeEffects.toFixed(2));
        created.setCvar('s_musicvolume', settings.volumeMusic.toFixed(2));
        created.setCvar('s_volumeVoice', settings.volumeVoice.toFixed(2));
        return created;
      })
      .finally(() => {
        bootPromiseRef.current = null;
        setEnginePreparing(false);
        setEngineProgress(null);
      });
    bootPromiseRef.current = promise;
    return promise;
  }, [
    settings.cgFov,
    settings.rGamma,
    settings.playbackSpeed,
    settings.volumeEffects,
    settings.volumeMusic,
    settings.volumeVoice,
    settings.texturePicmip,
    settings.textureMipmaps
  ]);

  const ensurePrepared = useCallback(async (engine: EngineHostApi, name: string): Promise<boolean> => {
    if (preparedDemoRef.current === name) return true;
    // Join any load already in progress.  If it prepared a different demo, the
    // loop starts the one the user actually asked for.
    while (preparePromiseRef.current) {
      await preparePromiseRef.current.catch(() => undefined);
      if (preparedDemoRef.current === name) return true;
    }
    setPreparingDemo(name);
    const promise = engine
      .prepareDemo(name)
      .then(() => {
        preparedDemoRef.current = name;
        return true;
      })
      .catch(error => {
        console.warn('Could not prepare the demo in the background.', error);
        preparedDemoRef.current = null;
        return false;
      })
      .finally(() => {
        preparePromiseRef.current = null;
        setPreparingDemo(null);
      });
    preparePromiseRef.current = promise;
    return promise;
  }, []);

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
      setDemoSummary(null);
      keyframesReadyRef.current = false;
      resetMissingAssets();
      if (result.errors.length === 0) {
        const bootFiles = pk3Files(next.files);
        const key = assetSetKey(bootFiles);
        if (engineRef.current && bootedAssetKeyRef.current && key !== bootedAssetKeyRef.current) {
          setError('The wasm engine was mounted with a different set of game-data PK3s. Reload the page to use the selected folder.');
          setPhase('error');
          return;
        }
        setStep('demo');
        void bootEngine(bootFiles, false).catch(() => undefined);
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
  }, [bootEngine, resetMissingAssets]);

  const handlePickAssets = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      // Brave, Firefox and older Chromium builds may not expose the directory
      // picker.  Use the directory-upload input instead of failing the wizard.
      folderInputRef.current?.click();
      return;
    }
    try {
      const picked = await pickGameData();
      if (picked) await applyAssets(picked.selection, picked.directory);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof DOMException && (err.name === 'NotSupportedError' || err.name === 'SecurityError')) {
        folderInputRef.current?.click();
        return;
      }
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

  const handleFolderFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const all = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (all.length === 0) return;
      // A directory upload can point at GameData or directly at base.  Keep
      // only the base tree when the browser gives us relative paths; fall back
      // to the flat list on browsers that do not expose webkitRelativePath.
      const underBase = (file: File) =>
        /(^|\/)base\//i.test((file.webkitRelativePath || '').replace(/\\/g, '/'));
      const hasBasePath = all.some(underBase);
      const selected = hasBasePath ? all.filter(underBase) : all;
      if (selected.length === 0) {
        setError('Select the GameData folder (or its base folder) so assets0.pk3 is included.');
        setPhase('error');
        return;
      }
      void applyAssets(selectionFromFileList(selected));
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
      setDemoSummary(null);
      keyframesReadyRef.current = false;
      resetMissingAssets();
      if (file) {
        const warning = await validateDemoFile(file.file);
        setDemoWarning(warning);
      }
    },
    [resetMissingAssets]
  );

  const handleDemoSelect = useCallback(
    async (name: string) => {
      const file = assetSelection?.demos.find(d => d.name === name) ?? null;
      void selectDemo(file);
      // Switching demos while the player is open must go back through the
      // map check: the new demo may need a different map PK3.
      if (engineRef.current && (phase === 'playing' || phase === 'paused' || phase === 'ended')) {
        const engine = engineRef.current;
        playbackRequestedRef.current = false;
        engine.disableFreeCam();
        engine.followClient(-1);
        setFreeCam(false);
        setFollowClient(null);
        setScoreboard(null);
        setRadar(null);
        setPhase('stopping');
        await engine.suspendDemo();
        preparedDemoRef.current = null;
        setPaused(false);
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

  // Settings → Local data.  There is no asset cache any more; clear the parsed
  // summaries (IndexedDB) and any leftover OPFS asset tree from older builds.
  const clearLocalData = useCallback(async () => {
    await clearDemoSummaries();
    await clearLegacyAssetCache();
  }, []);

  // The minimap reads the BSP and its textures straight from the game PK3s the
  // user already supplied: every PK3 in the selected base folder plus whichever
  // map PK3 was added for this demo.  A repeated name keeps the added file,
  // matching the engine's search path where /userdata/base overrides /jka/base.
  const minimapSources = useCallback(
    (extra: File[] = []): Blob[] => {
      const byName = new Map<string, Blob>();
      for (const file of [
        ...bootPk3Files.map(pk3 => pk3.file),
        ...addedPk3Files,
        ...extra
      ]) {
        byName.set((file as File).name, file);
      }
      return [...byName.values()];
    },
    [bootPk3Files, addedPk3Files]
  );
  const minimapFiles = useMemo<Blob[]>(() => minimapSources(), [minimapSources]);
  // The minimap rings the camera subject, not just an explicit follow: with the
  // demo camera that is the recorded POV, and after Follow it is that player.
  // Free cam has no subject of its own, so it clears the highlight.
  const minimapHighlight = freeCam
    ? null
    : (followClient ?? scoreboard?.view?.num ?? status?.clientNum ?? null);

  const checkMap = useCallback(async () => {
    if (!assetSelection || !demoFile || !canvasRef.current) return;
    setChecking(true);
    setMapError(null);
    setError(null);
    resetMissingAssets();

    let engine = engineRef.current;
    if (!engine || bootPromiseRef.current) {
      try {
        engine = await bootEngine(bootPk3Files, true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
        setChecking(false);
        return;
      }
    }

    // A background prepare from the previous demo must not race the scan.
    if (preparePromiseRef.current) {
      await preparePromiseRef.current.catch(() => undefined);
    }
    preparedDemoRef.current = null;

    engine.markStage('check-map:start');
    try {
      await engine.addDemoFile(demoFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
      setChecking(false);
      return;
    }

    setPhase('launcher');
    const name = demoBase(demoFile.name);
    const map = await engine.parseDemoMap(name);
    if (!map) {
      setMapError('The demo did not expose a mapname in its first gamestate. The file may be truncated or not protocol 26.');
      setMapName('');
      setMapMissing(false);
      setStep('map');
      setChecking(false);
      return;
    }
    const present = await engine.hasMap(map);
    setMapName(map);
    setMapMissing(!present);
    setStep('map');
    setDemoInfo(null);
    setDemoSummary(null);
    engine.markStage('check-map:demo-staged');

    // The scan builds the in-memory seek keyframes as well as the summary.
    // A cached summary is only enough when this engine already has keyframes
    // for the demo; otherwise scan again (the scan no longer loads the map).
    // Bump the cache key when the summary format or game-boundary logic
    // changes so old cached summaries are not reused.
    const cacheKey = `v12:${demoFile.name}:${demoFile.file.size}:${demoFile.file.lastModified}`;
    const hadKeyframes = keyframesReadyRef.current;
    let summary = hadKeyframes ? await loadDemoSummary(cacheKey) : null;
    let info: DemoInfo | null = null;
    if (summary) {
      info = {
        first: summary.first,
        duration: summary.duration,
        fullSnapshots: summary.fullSnapshots,
        totalSnapshots: summary.totalSnapshots
      };
    } else {
      engine.markStage('check-map:scan-start');
      info = await engine.demoInfo(name);
      if (info) {
        summary = await engine.demoSummary();
        if (summary) {
          await saveDemoSummary(cacheKey, summary);
        }
      }
      keyframesReadyRef.current = true;
      engine.markStage('check-map:scan-done');
    }
    setDemoInfo(info);
    setDemoSummary(summary);
    demoSummaryRef.current = summary;
    engine.markStage('check-map:done');
    setChecking(false);

    if (present) {
      // Keep the wizard visible while the demo loads in the background.  Play
      // joins this promise instead of starting a second map load.
      setPhase('launcher');
      // Build the minimap now, while the map step is visible, so opening the
      // player does not pay for the archive/texture pass during playback.
      void loadMapImage(map, minimapSources());
      void ensurePrepared(engine, name);
    }
  }, [assetSelection, bootPk3Files, demoFile, bootEngine, ensurePrepared, minimapSources, resetMissingAssets]);

  const startPlay = useCallback(async () => {
    if (!demoFile || mapMissing || !canvasRef.current) return;
    if (playbackActionRef.current) return;
    playbackActionRef.current = true;
    playbackRequestedRef.current = true;
    setPaused(false);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setRadar(null);
    setPhase('loading');
    try {
      let engine = engineRef.current;
      if (!engine) {
        engine = await bootEngine(bootPk3Files, true);
      }
      engine.disableFreeCam();
      engine.followClient(-1);
      engine.markStage('play:start');
      const name = demoBase(demoFile.name);
      // Stop after the demo ended must restart it, not resume the last frame.
      const ended = statusRef.current?.ended === 1;
      const prepared = !ended && (await ensurePrepared(engine, name));
      if (prepared) {
        await engine.resumeDemo();
      } else {
        await engine.playDemo(name);
      }
      preparedDemoRef.current = name;
      engine.markStage('play:command-done');
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      playbackActionRef.current = false;
    }
  }, [bootPk3Files, bootEngine, demoFile, ensurePrepared, mapMissing]);

  const handleMapFileInput = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).filter(file => file.name.toLowerCase().endsWith('.pk3'));
      event.target.value = '';
      const engine = engineRef.current;
      if (!demoFile || !engine) return;
      if (files.length === 0) {
        setMapError('Select a .pk3 file.');
        return;
      }
      setAddingPk3s(true);
      setMapError(null);
      resetMissingAssets();
      try {
        // FS_Restart must not run inside a map load.  A community map can also
        // depend on models or textures from another PK3, so this accepts
        // several files and restarts the search path once.
        if (preparePromiseRef.current) {
          await preparePromiseRef.current.catch(() => undefined);
        }
        // The warm map was loaded before these PK3s existed, and
        // JKA_PrepareDemo would consider it prepared.  Tear it down so the next
        // prepare/Play uses the new search path.
        try {
          await engine.stopDemo();
        } catch {
          // Nothing warm to stop.
        }
        preparedDemoRef.current = null;
        await engine.addPk3Files(files);
        // A background prepare can start while the files are being read and
        // the search path is restarted; that warm map predates the new PK3s.
        // Stop it so the prepare below reloads instead of reporting already-warm.
        try {
          await engine.stopDemo();
        } catch {
          // Nothing warm to stop.
        }
        preparedDemoRef.current = null;
        setAddedPk3s(current => Array.from(new Set([...current, ...files.map(file => file.name)])));
        setAddedPk3Files(current => {
          const names = new Set(current.map(file => file.name));
          return [...current, ...files.filter(file => !names.has(file.name))];
        });
        const map = await engine.parseDemoMap(demoBase(demoFile.name));
        if (!map) {
          setMapError('Could not re-read the demo map after adding the PK3.');
          return;
        }
        setMapName(map);
        const present = await engine.hasMap(map);
        setMapMissing(!present);
        if (!present) {
          setMapError(`maps/${map}.bsp is still missing. Add the map PK3 that contains it.`);
          return;
        }
        setPhase('launcher');
        void loadMapImage(map, minimapSources(files));
        void ensurePrepared(engine, demoBase(demoFile.name));
      } catch (err) {
        setMapError(err instanceof Error ? err.message : String(err));
      } finally {
        setAddingPk3s(false);
      }
    },
    [demoFile, ensurePrepared, minimapSources, resetMissingAssets]
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
    if (playbackActionRef.current) return;
    playbackActionRef.current = true;
    playbackRequestedRef.current = true;
    engine.disableFreeCam();
    engine.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setRadar(null);
    setPaused(false);
    setPhase('loading');
    engine.markStage('restart:start');
    try {
      const name = demoBase(demoFile.name);
      // A warm seek to the first snapshot avoids another map/cgame load.
      // Without a timeline/keyframes the bridge falls back to the old path.
      if (demoInfo) {
        await engine.seekDemo(name, demoInfo.first);
      } else {
        await engine.playDemo(name);
      }
      preparedDemoRef.current = name;
      engine.markStage('restart:done');
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      playbackActionRef.current = false;
    }
  }, [demoFile, demoInfo]);

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
    setRadar(null);
    setPaused(false);
    playbackRequestedRef.current = true;
    setPhase('seeking');
    engine.markStage(`seek:start target=${target}`);

    try {
      // Seeking from a paused player should resume the engine first.
      await engine.setPaused(false);
      await engine.seekDemo(demoBase(demoFile.name), target);
      preparedDemoRef.current = demoBase(demoFile.name);
      engine.markStage('seek:done');
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [demoFile, demoInfo]);

  // Start the demo at an absolute demo time, booting the engine first when the
  // summary is still only a launcher preview.  The optional lead-in backs the
  // seek up a little (the script panel wants to show the approach to a burst).
  const playFromMoment = useCallback(
    async (time: number, options?: { leadInMs?: number; followNum?: number }) => {
      if (!demoFile || mapMissing || !demoInfo || !canvasRef.current) return;
      if (playbackActionRef.current) return;
      playbackActionRef.current = true;
      playbackRequestedRef.current = true;
      const leadInMs = options?.leadInMs ?? 0;
      const followNum = options?.followNum ?? -1;
      const position = Math.max(
        0,
        Math.min(
          Math.max(0, demoInfo.duration - 250),
          Math.round(time - demoInfo.first - leadInMs)
        )
      );
      const target = demoInfo.first + position;
      setPaused(false);
      setFreeCam(false);
      setFollowClient(null);
      setScoreboard(null);
      setRadar(null);
      setPhase('loading');
      try {
        let engine = engineRef.current;
        if (!engine) {
          engine = await bootEngine(bootPk3Files, true);
        }
        engine.disableFreeCam();
        engine.followClient(-1);
        engine.markStage(`play-from:start target=${target}`);
        const name = demoBase(demoFile.name);
        const ended = statusRef.current?.ended === 1;
        const prepared = !ended && (await ensurePrepared(engine, name));
        if (prepared) {
          await engine.resumeDemo();
        } else {
          await engine.playDemo(name);
        }
        preparedDemoRef.current = name;
        // A fresh play starts at the first snapshot; a warm demo can be
        // anywhere, so always seek it to the chosen moment (also at 0:00).
        if (prepared || position > 0) {
          setPhase('seeking');
          await engine.setPaused(false);
          await engine.seekDemo(name, target);
        }
        if (followNum >= 0) {
          engine.followClient(followNum);
          setFollowClient(followNum);
        }
        engine.markStage('play-from:done');
        setPhase('playing');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      } finally {
        playbackActionRef.current = false;
      }
    },
    [bootPk3Files, bootEngine, demoFile, demoInfo, ensurePrepared, mapMissing]
  );

  // "Watch this moment" from the input-script panel: start playback if needed,
  // seek to just before the flagged burst, then follow the flagged player.
  // The recorded POV has no entity in a demo, so following it would clear the
  // follow; its first-person demo camera already is the right POV.
  const watchScriptMoment = useCallback(
    (time: number, followNum: number) =>
      playFromMoment(time, { leadInMs: 2500, followNum }),
    [playFromMoment]
  );

  // A moment picked on a summary chart: play from exactly there.
  const playFromChart = useCallback(
    (time: number) => playFromMoment(time),
    [playFromMoment]
  );

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    // Clear this before suspending so a late active status cannot put the UI
    // back into playback while the wizard is showing.
    playbackRequestedRef.current = false;
    engine?.disableFreeCam();
    engine?.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setRadar(null);
    setPhase('stopping');
    engine?.markStage('stop:start');
    try {
      // Keep-warm Stop: pause the loop, keep the map/cgame/frame loaded.
      await engine?.suspendDemo();
      engine?.markStage('stop:done');
    } catch (error) {
      console.warn('Could not suspend the demo cleanly.', error);
    }
    setPaused(false);
    setPhase('launcher');
    setStep('map');
  }, []);

  const releaseMemory = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.mode === 'main-thread') {
      // The main-thread module cannot be unloaded reliably, and its teardown
      // can stall while the keep-warm loop is paused.  A reload is the only
      // honest way to return the wasm/MEMFS memory to the browser.
      window.location.reload();
      return;
    }
    playbackRequestedRef.current = false;
    setPhase('stopping');
    try {
      await engine.releaseEngine();
    } catch (error) {
      console.warn('Could not release the engine cleanly.', error);
    }
    engine.destroy();
    engineRef.current = null;
    bootPromiseRef.current = null;
    bootedAssetKeyRef.current = null;
    preparedDemoRef.current = null;
    preparePromiseRef.current = null;
    keyframesReadyRef.current = false;
    resetMissingAssets();
    setPreparingDemo(null);
    setEngineActive(false);
    setEngineMode(null);
    setStatus(null);
    setScoreboard(null);
    setRadar(null);
    setAddedPk3s([]);
    setAddedPk3Files([]);
    setAddingPk3s(false);
    // The minimap images belong to the released engine session; drop them so
    // a later map starts clean instead of keeping up to three 4 MB rasters.
    clearMapImageCache();
    // The transferred canvas cannot be reused, so replace the element for the
    // next boot.
    setCanvasGeneration(generation => generation + 1);
    setPhase('launcher');
    // The new engine has no demo/map staged.  Send the user back through the
    // demo/map check instead of offering a Play that would fail.
    setStep('demo');
  }, [resetMissingAssets]);

  const fullscreen = useCallback(() => {
    stageRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const reload = useCallback(() => window.location.reload(), []);

  const currentGame = demoSummary && status ? chooseGame(demoSummary, status.serverTime) : null;
  const matchMs = currentGame && status
    ? Math.max(0, currentGame.levelTime - Math.max(0, currentGame.endTime - status.serverTime))
    : (scoreboard?.levelTime ?? 0);
  const matchTime = formatTime(matchMs);
  // Textures are uploaded with r_gamma at boot. Apply the difference since
  // then as a canvas gamma filter so the slider is immediate without a map
  // reload, and without double-correcting after a reload.
  const gammaExponent = (bootGammaRef.current || 1) / Math.max(0.5, Math.min(3, settings.rGamma));
  const gammaFilter = Math.abs(gammaExponent - 1) > 0.01 ? 'url(#jka-gamma)' : undefined;
  // The cgame widens the horizontal FOV for a display that is not 4:3; the
  // minimap's view cone should show that same angle.
  const displayFov = useMemo(() => {
    const half = (settings.cgFov * Math.PI) / 360;
    return (2 * Math.atan(Math.tan(half) * 0.75 * stageAspect) * 180) / Math.PI;
  }, [settings.cgFov, stageAspect]);
  const demoPosition = demoInfo && status ? Math.max(0, status.serverTime - demoInfo.first) : 0;
  // Obituary events with a real attacker are kills; colour them by the killer's
  // team.  Environment deaths and self-kills have no killer and get no marker.
  const killMarkers = useMemo<KillMarker[]>(() => {
    if (!demoSummary || !demoInfo) return [];
    const markers: KillMarker[] = [];
    for (const game of demoSummary.games) {
      if (game.events.length === 0) continue;
      const teams = new Map<number, number>();
      for (const player of game.players) teams.set(player.num, player.team);
      for (const event of game.events) {
        if (event.attacker < 0 || event.attacker === event.target) continue;
        const at = event.time - demoInfo.first;
        if (at < 0 || at > demoInfo.duration) continue;
        markers.push({ at, team: teams.get(event.attacker) ?? 3 });
      }
    }
    return markers;
  }, [demoSummary, demoInfo]);
  const showWizard = phase === 'launcher' || phase === 'validating';
  const showPlayer = phase === 'playing' || phase === 'paused' || phase === 'ended';
  // The scoreboard is a side panel normally, and an in-stage overlay while the
  // stage itself is the fullscreen element.
  const scoreboardPanel = showPlayer && settings.showScoreboard ? (
    <ScoreboardPanel
      data={scoreboard}
      followClient={followClient}
      freeCam={freeCam}
      pointerLocked={pointerLocked}
      onFollow={followPlayer}
      onToggleFreeCam={toggleFreeCam}
      onCaptureMouse={captureMouse}
      onDemoCamera={demoCamera}
    />
  ) : null;
  // A demo chosen from a file input may not be in the folder list.
  const playbackDemos: Array<{ name: string }> = (() => {
    const list = assetSelection?.demos ?? [];
    const name = demoFile?.name;
    if (!name || list.some(demo => demo.name === name)) return list;
    return [{ name }, ...list];
  })();

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
          {missingAssets.length ? (
            <button className="ghost missing-action" onClick={() => setShowMissingAssets(true)}>
              Missing assets ({missingAssets.length})
            </button>
          ) : null}
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
        <div
          className={
            showPlayer && settings.showScoreboard
              ? 'play-area'
              : 'play-area solo'
          }
        >
          {showPlayer && playbackDemos.length > 1 ? (
            <div className="play-toolbar">
              <label className="demo-switcher">
                <span>Demo</span>
                <select
                  value={demoFile?.name ?? ''}
                  onChange={event => {
                    void handleDemoSelect(event.target.value);
                  }}
                >
                  {playbackDemos.map(demo => (
                    <option key={demo.name} value={demo.name}>{demo.name}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <div className="play-row">
            <div
              className="stage"
              ref={stageRef}
              style={
                {
                  '--stage-aspect': stageAspect.toFixed(4),
                  '--pip-width': `${pip.width}%`
                } as CSSProperties
              }
              data-minimap={showPlayer && settings.showMinimap ? '1' : undefined}
              data-swapped={
                showPlayer && settings.showMinimap && settings.mapExpanded ? '1' : undefined
              }
              data-pip-corner={
                showPlayer && settings.showMinimap && settings.mapExpanded ? pip.corner : undefined
              }
            >
              <svg className="gamma-filter" aria-hidden="true" focusable="false">
                <filter id="jka-gamma" colorInterpolationFilters="sRGB">
                  <feComponentTransfer>
                    <feFuncR type="gamma" amplitude={1} exponent={gammaExponent} offset={0} />
                    <feFuncG type="gamma" amplitude={1} exponent={gammaExponent} offset={0} />
                    <feFuncB type="gamma" amplitude={1} exponent={gammaExponent} offset={0} />
                  </feComponentTransfer>
                </filter>
              </svg>
              <canvas
                key={canvasGeneration}
                ref={canvasRef}
                width={800}
                height={600}
                className="screen"
                style={{ filter: gammaFilter }}
              />

              {showPlayer && settings.showMinimap && settings.mapExpanded ? (
                <CornerDemo
                  corner={pip.corner}
                  width={pip.width}
                  onWidthChange={resizePip}
                  onCommit={commitPip}
                  onExpand={expandDemo}
                />
              ) : null}

              {showWizard ? (
                <Launcher
                  step={step}
                  assetSelection={assetSelection}
                  assetValidation={assetValidation}
                  demoFile={demoFile}
                  demoWarning={demoWarning}
                  mapName={mapName}
                  mapFiles={minimapFiles}
                  mapMissing={mapMissing}
                  mapError={mapError}
                  missingAssets={missingAssets}
                  addedPk3s={addedPk3s}
                  addingPk3s={addingPk3s}
                  summary={demoSummary}
                  engineMode={engineMode}
                  enginePreparing={enginePreparing}
                  preparingDemo={!!preparingDemo}
                  engineActive={engineActive}
                  onReleaseMemory={releaseMemory}
                  engineProgress={engineProgress}
                  savedHandle={savedHandle}
                  busy={checking}
                  onPickAssets={handlePickAssets}
                  onSaved={handleSaved}
                  onAssetsFileInput={handleAssetsFileInput}
                  onFolderFileInput={handleFolderFileInput}
                  assetInputRef={assetInputRef}
                  folderInputRef={folderInputRef}
                  demoInputRef={demoInputRef}
                  mapInputRef={mapInputRef}
                  onDemoSelect={handleDemoSelect}
                  onDemoFileInput={handleDemoFileInput}
                  onCheckMap={checkMap}
                  onMapFileInput={handleMapFileInput}
                  onShowMissingAssets={() => setShowMissingAssets(true)}
                  onWatchScript={watchScriptMoment}
                  onPlayFrom={playFromChart}
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
                  matchTime={matchTime}
                  speed={settings.playbackSpeed}
                  onSpeedChange={value => setSettings(current => ({ ...current, playbackSpeed: value }))}
                  volumes={{
                    effects: settings.volumeEffects,
                    music: settings.volumeMusic,
                    voice: settings.volumeVoice
                  }}
                  onVolumeChange={(kind, value) => {
                    const key =
                      kind === 'effects' ? 'volumeEffects' : kind === 'music' ? 'volumeMusic' : 'volumeVoice';
                    setSettings(current => ({ ...current, [key]: Math.min(1, Math.max(0, value)) }));
                  }}
                  paused={paused}
                  phase={phase}
                  scores={scoreboard}
                  game={currentGame}
                  heatmap={settings.heatmap}
                  onHeatmapChange={mode => setSettings(current => ({ ...current, heatmap: mode }))}
                  view={scoreboard?.view ?? null}
                  showScores={settings.showScores}
                  showTimer={settings.showTimer}
                  showMinimap={settings.showMinimap}
                  mapExpanded={settings.mapExpanded}
                  onExpandMap={expandMap}
                  showPastTrails={settings.trailsPast}
                  showFutureTrails={settings.trailsFuture}
                  trailsFollowOnly={settings.trailsFollowOnly}
                  loadTrajectory={loadTrajectory}
                  mapName={status?.map || mapName}
                  mapFiles={minimapFiles}
                  radar={radar}
                  fov={displayFov}
                  highlightClient={minimapHighlight}
                  onFollow={followPlayer}
                  onToggleMinimap={() =>
                    setSettings(current => {
                      const showMinimap = !current.showMinimap;
                      // Hiding the map returns the demo to the full stage.
                      return { ...current, showMinimap, mapExpanded: showMinimap && current.mapExpanded };
                    })
                  }
                  currentMs={demoPosition}
                  durationMs={demoInfo?.duration ?? 0}
                  killMarkers={killMarkers}
                  onPause={togglePause}
                  onRestart={restart}
                  onStop={stop}
                  onFullscreen={fullscreen}
                  onSeek={handleSeek}
                />
              ) : null}

              {showPlayer ? (
                <KillFeed game={currentGame} serverTime={status?.serverTime ?? 0} />
              ) : null}

              {stageFullscreen && scoreboardPanel ? (
                <div className="stage-scoreboard">{scoreboardPanel}</div>
              ) : null}
            </div>

            {!stageFullscreen && scoreboardPanel ? scoreboardPanel : null}
          </div>
        </div>
      </main>

      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          onClearLocalData={clearLocalData}
        />
      ) : null}

      {showMissingAssets && missingAssets.length ? (
        <MissingAssetsPanel
          assets={missingAssets}
          onClose={() => setShowMissingAssets(false)}
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
