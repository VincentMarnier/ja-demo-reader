import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AssetSelection, DemoInfo, DemoStatus, DemoSummary, FreeCamPose, KillMarker, LocalFile, Phase, ScoreboardData, StageProgress, ValidationResult } from './types';
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
import { chooseGame, mergeScoreboard } from './summary';
import { formatTime } from './format';
import { createEngineHost, WorkerUnsupportedError } from './engine/host';
import type { EngineHostApi, EngineMode } from './engine/host';
import { Launcher } from './components/Launcher';
import { Player } from './components/Player';
import { ProgressOverlay } from './components/ProgressOverlay';
import { ErrorPanel } from './components/ErrorPanel';
import { ScoreboardPanel } from './components/ScoreboardPanel';
import { SettingsPanel } from './components/SettingsPanel';
import type { AppSettings } from './settings';
import { loadSettings, saveSettings } from './settings';

type WizardStep = 'assets' | 'demo' | 'map';

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
  const [paused, setPaused] = useState(false);
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [scoreboard, setScoreboard] = useState<ScoreboardData | null>(null);
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

    bootedAssetKeyRef.current = assetSetKey(files.filter(file => /^assets[0-3]\.pk3$/i.test(file.name)));

    const bootHost = async (host: EngineHostApi): Promise<EngineHostApi> => {
      engineRef.current = host;
      setEngineMode(host.mode);
      try {
        await host.boot({
          canvas,
          files,
          signal: controller.signal,
          texturePicmip: settings.texturePicmip,
          textureMipmaps: settings.textureMipmaps
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
      if (result.errors.length === 0) {
        const key = assetSetKey(result.assets);
        if (engineRef.current && bootedAssetKeyRef.current && key !== bootedAssetKeyRef.current) {
          setError('The wasm engine was preloaded with a different asset set. Reload the page to use the selected folder.');
          setPhase('error');
          return;
        }
        setStep('demo');
        void bootEngine(result.assets, false).catch(() => undefined);
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
  }, [bootEngine]);

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
        const engine = engineRef.current;
        playbackRequestedRef.current = false;
        engine.disableFreeCam();
        engine.followClient(-1);
        setFreeCam(false);
        setFollowClient(null);
        setScoreboard(null);
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

  const checkMap = useCallback(async () => {
    if (!assetSelection || !demoFile || !canvasRef.current) return;
    setChecking(true);
    setMapError(null);
    setError(null);

    let engine = engineRef.current;
    if (!engine || bootPromiseRef.current) {
      try {
        engine = await bootEngine(assetValidation?.assets ?? [], true);
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
    const cacheKey = `v3:${demoFile.name}:${demoFile.file.size}:${demoFile.file.lastModified}`;
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
      void ensurePrepared(engine, name);
    }
  }, [assetSelection, assetValidation, demoFile, bootEngine, ensurePrepared]);

  const startPlay = useCallback(async () => {
    if (!demoFile || mapMissing || !canvasRef.current) return;
    if (playbackActionRef.current) return;
    playbackActionRef.current = true;
    playbackRequestedRef.current = true;
    setPaused(false);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    setPhase('loading');
    try {
      let engine = engineRef.current;
      if (!engine) {
        engine = await bootEngine(assetValidation?.assets ?? [], true);
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
  }, [assetValidation, bootEngine, demoFile, ensurePrepared, mapMissing]);

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
        const map = await engineRef.current.parseDemoMap(demoBase(demoFile.name));
        if (!map) {
          setMapError('Could not re-read the demo map after adding the PK3.');
          return;
        }
        setMapName(map);
        const present = await engineRef.current.hasMap(map);
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
    if (playbackActionRef.current) return;
    playbackActionRef.current = true;
    playbackRequestedRef.current = true;
    engine.disableFreeCam();
    engine.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
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
    setPreparingDemo(null);
    setEngineActive(false);
    setEngineMode(null);
    setStatus(null);
    setScoreboard(null);
    // The transferred canvas cannot be reused, so replace the element for the
    // next boot.
    setCanvasGeneration(generation => generation + 1);
    setPhase('launcher');
    // The new engine has no demo/map staged.  Send the user back through the
    // demo/map check instead of offering a Play that would fail.
    setStep('demo');
  }, []);

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
            <div className="stage" ref={stageRef}>
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
                  view={scoreboard?.view ?? null}
                  showScores={settings.showScores}
                  showTimer={settings.showTimer}
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
            </div>
          </div>

          {showPlayer && settings.showScoreboard ? (
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
          ) : null}
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
