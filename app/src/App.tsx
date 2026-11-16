import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AssetSelection, DemoInfo, DemoStatus, DemoSummary, FreeCamPose, LocalFile, Phase, ScoreboardData, StageProgress, ValidationResult } from './types';
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
import { assetCacheKey, clearAssetCache, loadCachedAssets, saveAssetFiles } from './fs/assetCache';
import type { CachedAssets } from './fs/assetCache';
import { chooseGame, mergeScoreboard } from './summary';
import { formatTime } from './format';
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
  const [cachedAssets, setCachedAssets] = useState<CachedAssets | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  const [enginePreparing, setEnginePreparing] = useState(false);
  const [engineProgress, setEngineProgress] = useState<StageProgress | null>(null);
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
  const demoSummaryRef = useRef<DemoSummary | null>(null);
  const statusRef = useRef<DemoStatus | null>(null);
  const cacheInFlightRef = useRef(false);
  const playbackActionRef = useRef(false);
  const bootPromiseRef = useRef<Promise<EngineHost> | null>(null);
  const bootForegroundRef = useRef(false);
  const bootedAssetKeyRef = useRef<string | null>(null);
  const bootGammaRef = useRef(1);

  useEffect(() => {
    loadDirectoryHandle().then(handle => setSavedHandle(handle));
    loadCachedAssets().then(cached => {
      if (cached) setCachedAssets(cached);
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
    if (phase !== 'playing' && phase !== 'paused' && phase !== 'ended') return;
    const tick = () => {
      const data = engineRef.current?.getScoreboard();
      if (data) {
        setScoreboard(mergeScoreboard(data, demoSummaryRef.current, statusRef.current?.serverTime ?? 0));
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
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

  const bootEngine = useCallback(async (files: LocalFile[], foreground: boolean): Promise<EngineHost> => {
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

    const created = new EngineHost({
      onLog: () => undefined,
      onProgress: next => {
        setProgress(next);
        setEngineProgress(next);
        if (bootForegroundRef.current) {
          setPhase(next.total > 0 && next.loaded >= next.total ? 'booting' : 'staging');
        } else {
          setEnginePreparing(true);
        }
      },
      onStatus: next => {
        statusRef.current = next;
        setStatus(next);
        if (playbackRequestedRef.current && next.state === CA_ACTIVE && next.demo === 1) {
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
    bootedAssetKeyRef.current = assetCacheKey(files.filter(file => /^assets[0-3]\.pk3$/i.test(file.name)));

    const promise = created
      .boot({
        canvas,
        files,
        signal: controller.signal,
        texturePicmip: settings.texturePicmip,
        textureMipmaps: settings.textureMipmaps
      })
      .then(() => {
        bootGammaRef.current = settings.rGamma;
        created.setCvar('cg_fov', String(settings.cgFov));
        created.setCvar('r_gamma', String(settings.rGamma));
        created.setCvar('timescale', String(settings.playbackSpeed));
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
    settings.texturePicmip,
    settings.textureMipmaps
  ]);

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
      if (result.errors.length === 0) {
        const key = assetCacheKey(result.assets);
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
      setDemoSummary(null);
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

  const cacheAssets = useCallback(async (files: LocalFile[], label: string) => {
    const assets = files.filter(file => /^assets[0-3]\.pk3$/i.test(file.name));
    if (assets.length !== 4) return;
    if (cacheInFlightRef.current) return;
    if (cachedAssets && cachedAssets.key === assetCacheKey(assets)) return;
    cacheInFlightRef.current = true;
    setCacheStatus('Caching game data for faster reloads…');
    try {
      const saved = await saveAssetFiles(assets, label, progress => {
        const percent = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
        setCacheStatus(`Caching game data… ${percent}%`);
      });
      if (saved) setCachedAssets(saved);
    } finally {
      cacheInFlightRef.current = false;
      setCacheStatus(null);
    }
  }, [cachedAssets]);

  const useCachedAssets = useCallback(async () => {
    if (!cachedAssets) return;
    await applyAssets({ files: cachedAssets.files, demos: [], label: cachedAssets.label });
  }, [cachedAssets]);

  const clearCache = useCallback(async () => {
    await clearAssetCache();
    await clearDemoSummaries();
    setCachedAssets(null);
    setCacheStatus(null);
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
    setDemoSummary(null);
    engine.markStage('check-map:demo-staged');

    // Scanning an eight-minute demo takes a few seconds. Cache the parsed
    // summary per file so the map step and the resume are instant next time.
    // Bump this when the summary format or game-boundary logic changes so
    // old cached summaries are not reused.
    const cacheKey = `v3:${demoFile.name}:${demoFile.file.size}:${demoFile.file.lastModified}`;
    let summary = await loadDemoSummary(cacheKey);
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
        summary = engine.demoSummary();
        if (summary) {
          await saveDemoSummary(cacheKey, summary);
        }
      }
      engine.markStage('check-map:scan-done');
    }
    setDemoInfo(info);
    setDemoSummary(summary);
    demoSummaryRef.current = summary;
    engine.markStage('check-map:done');
    setChecking(false);
    void cacheAssets(assetValidation?.assets ?? [], 'Retail assets');

    if (present) {
      // Keep the engine warm; Play starts the actual demo.
      setPhase('launcher');
    }
  }, [assetSelection, assetValidation, demoFile, cacheAssets, bootEngine]);

  const startPlay = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !demoFile || mapMissing) return;
    if (playbackActionRef.current) return;
    playbackActionRef.current = true;
    engine.disableFreeCam();
    engine.followClient(-1);
    setFreeCam(false);
    setFollowClient(null);
    setScoreboard(null);
    playbackRequestedRef.current = true;
    setPaused(false);
    setPhase('loading');
    engine.markStage('play:start');
    try {
      await engine.playDemo(demoBase(demoFile.name));
      engine.markStage('play:command-done');
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      playbackActionRef.current = false;
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
      await engine.playDemo(demoBase(demoFile.name));
      engine.markStage('restart:done');
      setPhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    } finally {
      playbackActionRef.current = false;
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
    engine.markStage(`seek:start target=${target}`);

    try {
      // Seeking from a paused player should resume the engine first.
      await engine.setPaused(false);
      await engine.seekDemo(demoBase(demoFile.name), target);
      engine.markStage('seek:done');
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
    engine?.markStage('stop:start');
    try {
      await engine?.stopDemo();
      engine?.markStage('stop:done');
    } catch (error) {
      // The UI should still return to the map step even if the engine call
      // misbehaves; the next Play reuses or reloads the engine.
      console.warn('Could not stop the demo cleanly.', error);
    }
    playbackRequestedRef.current = false;
    setPaused(false);
    setPhase('launcher');
    setStep('map');
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
          <svg className="gamma-filter" aria-hidden="true" focusable="false">
            <filter id="jka-gamma" colorInterpolationFilters="sRGB">
              <feComponentTransfer>
                <feFuncR type="gamma" amplitude={1} exponent={gammaExponent} offset={0} />
                <feFuncG type="gamma" amplitude={1} exponent={gammaExponent} offset={0} />
                <feFuncB type="gamma" amplitude={1} exponent={gammaExponent} offset={0} />
              </feComponentTransfer>
            </filter>
          </svg>
          <canvas ref={canvasRef} width={800} height={600} className="screen" style={{ filter: gammaFilter }} />

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
              cachedAssets={cachedAssets}
              cacheStatus={cacheStatus}
              enginePreparing={enginePreparing}
              engineProgress={engineProgress}
              onUseCachedAssets={useCachedAssets}
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
              matchTime={matchTime}
              speed={settings.playbackSpeed}
              onSpeedChange={value => setSettings(current => ({ ...current, playbackSpeed: value }))}
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
          onClearCache={clearCache}
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
