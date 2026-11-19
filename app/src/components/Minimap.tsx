import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { loadMapImage } from '../map/mapImage';
import type { MapBounds } from '../map/bsp';
import {
  buildDamageHeatmapSource,
  combinedMax,
  HEATMAP_MODES,
  heatmapIsTeam,
  heatmapKind,
  playerDamageTotals,
  playerTeams,
  rasterizeHeatmap,
  teamDamageTotals,
  type DamageHeatmapMode
} from '../map/damageHeatmap';
import { heatmapCanvas, teamHeatmapCanvas, TEAM_HEAT_HUE } from '../map/heatmapCanvas';
import { playerTone, toneColor } from '../map/playerTone';
import { stripColors } from '../saber';
import type { DemoGameSummary, RadarData, ScoreboardData, TrajectoryData } from '../types';

interface MinimapProps {
  mapName: string;
  /** The user's PK3 blobs; the map image is read straight from them. */
  files: readonly Blob[];
  radar: RadarData | null;
  scores: ScoreboardData | null;
  /** The summary game around the live time; its damage events build the heatmaps. */
  game: DemoGameSummary | null;
  heatmap: DamageHeatmapMode;
  onHeatmapChange: (mode: DamageHeatmapMode) => void;
  /** Horizontal field of view in degrees, matching the demo camera. */
  fov: number;
  /** Camera subject: the demo POV or the player the camera follows. */
  highlightClient: number | null;
  onFollow: (clientNum: number) => void;
  /** The map fills the stage: drag to pan, scroll/pinch to zoom. */
  expanded: boolean;
  /** Promote the corner map to the full stage (a click on the small map). */
  onExpand: () => void;
  /** Movement trails: the recorded window on each side of the live time. */
  showPastTrails: boolean;
  showFutureTrails: boolean;
  trailsFollowOnly: boolean;
  loadTrajectory: (from: number, to: number) => Promise<TrajectoryData | null>;
}

interface TrailPoint {
  /** Server time, the same clock as RadarData.time. */
  t: number;
  x: number;
  y: number;
}

/** Visible trail length on each side of the current dot. */
const TRAIL_LENGTH_MS = 5000;
/** Fetched window: the visible five seconds plus headroom before a refetch. */
const TRAIL_WINDOW_MS = 7000;
/** Refetch once the live time comes this close to a cached window edge. */
const TRAIL_REFRESH_MARGIN_MS = 2000;
/** A longer sample gap is a PVS exit or a seek, not a movement line. */
const TRAIL_GAP_MS = 800;
/** A jump this large in one step is a respawn/teleport, like the dot snap. */
const TRAIL_SNAP_UNITS = 600;
/** Map view zoom limits and the click/drag threshold. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const PAN_SLOP = 4;

interface MapFit {
  scale: number;
  offsetX: number;
  offsetY: number;
  worldWidth: number;
  worldHeight: number;
}

interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  moved: boolean;
}

interface PinchGesture {
  distance: number;
  zoom: number;
  baseX: number;
  baseY: number;
}

interface Pose {
  x: number;
  y: number;
  yaw: number;
  dead: number;
  /** Feet height of the last grounded sample. */
  baseZ: number;
  /** Smoothed height above that ground sample; scales the airborne effect. */
  jump: number;
  targetJump: number;
}

interface DotHit {
  num: number;
  x: number;
  y: number;
}

function formatDamage(value: number): string {
  return Math.round(value).toLocaleString();
}

function playerName(game: DemoGameSummary | null, num: number | null): string {
  if (num === null) return '—';
  let found: DemoGameSummary['players'][number] | undefined;
  for (const player of game?.players ?? []) {
    if (player.num === num) found = player;
  }
  return found ? stripColors(found.name) || `Client ${num}` : `Client ${num}`;
}

export function Minimap({
  mapName,
  files,
  radar,
  scores,
  game,
  heatmap,
  onHeatmapChange,
  fov,
  highlightClient,
  onFollow,
  expanded,
  onExpand,
  showPastTrails,
  showFutureTrails,
  trailsFollowOnly,
  loadTrajectory
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<MapBounds | null>(null);
  const radarRef = useRef<RadarData | null>(radar);
  const teamsRef = useRef<Map<number, number>>(new Map());
  const fovRef = useRef(fov);
  const highlightRef = useRef<number | null>(highlightClient);
  const posesRef = useRef<Map<number, Pose>>(new Map());
  const dotsRef = useRef<DotHit[]>([]);
  const onFollowRef = useRef(onFollow);
  const trailsRef = useRef<Map<number, TrailPoint[]>>(new Map());
  const trailWindowRef = useRef<{ from: number; to: number } | null>(null);
  const trailLoadingRef = useRef(false);
  const trailRetryAtRef = useRef(0);
  const trailsPastRef = useRef(showPastTrails);
  const trailsFutureRef = useRef(showFutureTrails);
  const trailsFollowOnlyRef = useRef(trailsFollowOnly);
  const loadTrajectoryRef = useRef(loadTrajectory);
  const mountedRef = useRef(true);
  const onExpandRef = useRef(onExpand);
  const expandedRef = useRef(expanded);
  const fitRef = useRef<MapFit | null>(null);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panRef = useRef<PanGesture | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(mapName ? 'loading' : 'missing');
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [heatmapPlayer, setHeatmapPlayer] = useState<number | null>(null);
  const heatLayersRef = useRef<HTMLCanvasElement[]>([]);

  useEffect(() => {
    onExpandRef.current = onExpand;
  }, [onExpand]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // Pan/zoom keep the map image centred at zoom 1 and clamp so an edge cannot
  // leave a gap; a panned view is remembered while the map is in the corner.
  const clampView = useCallback((width: number, height: number) => {
    const fit = fitRef.current;
    const view = viewRef.current;
    if (!fit) {
      view.panX = 0;
      view.panY = 0;
      return;
    }
    if (view.zoom <= MIN_ZOOM + 0.001) {
      view.zoom = MIN_ZOOM;
      view.panX = 0;
      view.panY = 0;
      return;
    }
    const halfWidth = (fit.worldWidth * fit.scale * view.zoom) / 2;
    const halfHeight = (fit.worldHeight * fit.scale * view.zoom) / 2;
    const limitX = Math.max(0, halfWidth - width / 2);
    const limitY = Math.max(0, halfHeight - height / 2);
    view.panX = Math.min(limitX, Math.max(-limitX, view.panX));
    view.panY = Math.min(limitY, Math.max(-limitY, view.panY));
  }, []);

  const zoomAt = useCallback(
    (localX: number, localY: number, factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const width = canvas.clientWidth || 200;
      const height = canvas.clientHeight || 200;
      const view = viewRef.current;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
      if (Math.abs(next - view.zoom) < 0.001) return;
      const centerX = width / 2;
      const centerY = height / 2;
      // Base (zoom 1) coordinates under the cursor stay under it.
      const baseX = (localX - centerX - view.panX) / view.zoom + centerX;
      const baseY = (localY - centerY - view.panY) / view.zoom + centerY;
      view.zoom = next;
      view.panX = localX - centerX - (baseX - centerX) * next;
      view.panY = localY - centerY - (baseY - centerY) * next;
      clampView(width, height);
    },
    [clampView]
  );

  useEffect(() => {
    const element = canvasRef.current?.closest<HTMLElement>('.minimap');
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!expandedRef.current) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-event.deltaY * 0.0015)
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    trailsPastRef.current = showPastTrails;
  }, [showPastTrails]);

  useEffect(() => {
    trailsFutureRef.current = showFutureTrails;
  }, [showFutureTrails]);

  useEffect(() => {
    trailsFollowOnlyRef.current = trailsFollowOnly;
  }, [trailsFollowOnly]);

  useEffect(() => {
    loadTrajectoryRef.current = loadTrajectory;
  }, [loadTrajectory]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The scan holds the whole trajectory; ask only for a window around the
  // live time and refresh it as playback advances (or after a seek).
  useEffect(() => {
    const time = radar?.time ?? 0;
    if (!time || (!showPastTrails && !showFutureTrails)) return;
    if (trailLoadingRef.current || performance.now() < trailRetryAtRef.current) return;
    const windowed = trailWindowRef.current;
    if (
      windowed &&
      time >= windowed.from + TRAIL_REFRESH_MARGIN_MS &&
      time <= windowed.to - TRAIL_REFRESH_MARGIN_MS
    ) {
      return;
    }
    const from = time - TRAIL_WINDOW_MS;
    const to = time + TRAIL_WINDOW_MS;
    trailLoadingRef.current = true;
    void loadTrajectoryRef
      .current(from, to)
      .then(data => {
        trailLoadingRef.current = false;
        if (!data) {
          // The engine may still be between scans; do not ask on every radar
          // tick until it has data.
          trailRetryAtRef.current = performance.now() + 2000;
          return;
        }
        if (!mountedRef.current) return;
        const next = new Map<number, TrailPoint[]>();
        for (const sample of data?.samples ?? []) {
          const [num, t, x, y] = sample;
          if (!Number.isFinite(num) || !Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
          }
          let list = next.get(num);
          if (!list) {
            list = [];
            next.set(num, list);
          }
          list.push({ t, x, y });
        }
        trailsRef.current = next;
        trailWindowRef.current = { from, to };
      })
      .catch(() => {
        trailLoadingRef.current = false;
        trailRetryAtRef.current = performance.now() + 2000;
      });
  }, [radar, showPastTrails, showFutureTrails]);

  useEffect(() => {
    radarRef.current = radar;
  }, [radar]);

  useEffect(() => {
    const teams = new Map<number, number>();
    for (const player of scores?.players ?? []) teams.set(player.num, player.team);
    teamsRef.current = teams;
  }, [scores]);

  useEffect(() => {
    fovRef.current = fov;
  }, [fov]);

  useEffect(() => {
    highlightRef.current = highlightClient;
  }, [highlightClient]);

  useEffect(() => {
    onFollowRef.current = onFollow;
  }, [onFollow]);

  useEffect(() => {
    let cancelled = false;
    layerRef.current = null;
    boundsRef.current = null;
    setMapBounds(null);
    heatLayersRef.current = [];
    posesRef.current.clear();
    trailsRef.current = new Map();
    trailWindowRef.current = null;
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    pointersRef.current.clear();
    panRef.current = null;
    pinchRef.current = null;
    if (!mapName) {
      setStatus('missing');
      return;
    }
    setStatus('loading');
    void loadMapImage(mapName, files).then(image => {
      if (cancelled) return;
      if (!image) {
        setStatus('missing');
        return;
      }
      const layer = document.createElement('canvas');
      layer.width = image.width;
      layer.height = image.height;
      const context = layer.getContext('2d');
      if (!context) {
        setStatus('missing');
        return;
      }
      context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
      layerRef.current = layer;
      boundsRef.current = image.bounds;
      setMapBounds(image.bounds);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [mapName, files]);

  // The heatmap subject for the player layers: an explicit pick, else the
  // camera subject, else the recorded POV.
  const subject =
    heatmapPlayer ?? highlightClient ?? game?.pov ?? game?.players[0]?.num ?? null;
  useEffect(() => {
    if (heatmapPlayer === null || !game) return;
    if (!game.players.some(player => player.num === heatmapPlayer)) setHeatmapPlayer(null);
  }, [game, heatmapPlayer]);

  const subjectTeam = useMemo(
    () => (game && subject !== null ? playerTeams(game).get(subject) ?? 0 : 0),
    [game, subject]
  );

  const heatmapPlayers = useMemo(() => {
    const byNum = new Map<number, DemoGameSummary['players'][number]>();
    for (const player of game?.players ?? []) byNum.set(player.num, player);
    return [...byNum.values()].sort((a, b) =>
      stripColors(a.name).localeCompare(stripColors(b.name), 'en', { sensitivity: 'base' })
    );
  }, [game]);

  const heatSource = useMemo(
    () => (game && mapBounds ? buildDamageHeatmapSource(game, mapBounds) : null),
    [game, mapBounds]
  );

  // Team grids are cheap to build and both kinds are needed when the mode
  // changes; player grids follow the selected subject.
  const teamGrids = useMemo(() => {
    if (!heatSource) return null;
    return {
      given: {
        1: rasterizeHeatmap(heatSource, 'given', { team: 1 }),
        2: rasterizeHeatmap(heatSource, 'given', { team: 2 })
      },
      received: {
        1: rasterizeHeatmap(heatSource, 'received', { team: 1 }),
        2: rasterizeHeatmap(heatSource, 'received', { team: 2 })
      }
    };
  }, [heatSource]);

  const playerGrids = useMemo(() => {
    if (!heatSource || subject === null) return null;
    return {
      given: rasterizeHeatmap(heatSource, 'given', { player: subject }),
      received: rasterizeHeatmap(heatSource, 'received', { player: subject })
    };
  }, [heatSource, subject]);

  // Colourised layers are rebuilt only when the game or mode changes, not on
  // every animation frame.
  useEffect(() => {
    const layers: HTMLCanvasElement[] = [];
    const kind = heatmapKind(heatmap);
    if (kind && heatmapIsTeam(heatmap) && teamGrids) {
      const grids = teamGrids[kind];
      const max = combinedMax([grids[1], grids[2]]);
      const layer = teamHeatmapCanvas(grids[1], grids[2], max);
      if (layer) layers.push(layer);
    } else if (kind && playerGrids && subject !== null) {
      const grid = playerGrids[kind];
      const tone = playerTone(subject, subjectTeam);
      const layer = heatmapCanvas(grid, grid.max, tone.h, tone.s);
      if (layer) layers.push(layer);
    }
    heatLayersRef.current = layers;
  }, [heatmap, teamGrids, playerGrids, subject, subjectTeam]);

  const heatLegend = useMemo(() => {
    const kind = heatmapKind(heatmap);
    if (!kind || !game || !heatSource) return null;
    if (heatmapIsTeam(heatmap)) {
      const hasTeams = game.players.some(player => player.team === 1 || player.team === 2);
      if (!hasTeams) {
        return {
          empty: 'No red/blue teams in this game.',
          rows: [] as Array<{ label: string; color: string; value: string }>,
          placed: 0,
          total: 0
        };
      }
      const rows = [1, 2].map(team => {
        const totals = teamDamageTotals(game, team);
        return {
          label: `Team ${team}`,
          color: `hsl(${TEAM_HEAT_HUE[team]} 88% 62%)`,
          value: formatDamage(kind === 'given' ? totals.given : totals.received)
        };
      });
      const placed = kind === 'given' ? heatSource.givenDamage : heatSource.receivedDamage;
      const total = kind === 'given' ? heatSource.givenTotal : heatSource.receivedTotal;
      return { empty: null, rows, placed, total };
    }
    if (subject === null) return null;
    const totals = playerDamageTotals(game, subject);
    const tone = playerTone(subject, subjectTeam);
    return {
      empty: null,
      rows: [
        {
          label: playerName(game, subject),
          color: toneColor(tone),
          value: formatDamage(kind === 'given' ? totals.dealt : totals.received)
        }
      ],
      placed: kind === 'given' ? totals.placedDealt : totals.placedReceived,
      total: kind === 'given' ? totals.dealt : totals.received
    };
  }, [heatmap, game, heatSource, subject, subjectTeam]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let previous = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      previous = now;

      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth || 200;
      const height = canvas.clientHeight || 200;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const bounds = boundsRef.current;
      const layer = layerRef.current;
      let toScreen: ((x: number, y: number) => { x: number; y: number }) | null = null;

      if (layer && bounds) {
        const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
        const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
        const fitScale = Math.min(width / worldWidth, height / worldHeight) * 0.98;
        const fitOffsetX = (width - worldWidth * fitScale) / 2;
        const fitOffsetY = (height - worldHeight * fitScale) / 2;
        fitRef.current = {
          scale: fitScale,
          offsetX: fitOffsetX,
          offsetY: fitOffsetY,
          worldWidth,
          worldHeight
        };

        // The corner map is always the fitted overview; the full-stage map
        // pans and zooms, and remembers its view across a collapse.
        const view = viewRef.current;
        if (expandedRef.current) clampView(width, height);
        const zoom = expandedRef.current ? view.zoom : MIN_ZOOM;
        const panX = expandedRef.current ? view.panX : 0;
        const panY = expandedRef.current ? view.panY : 0;
        const centerX = width / 2;
        const centerY = height / 2;
        const imageX = centerX + (fitOffsetX - centerX) * zoom + panX;
        const imageY = centerY + (fitOffsetY - centerY) * zoom + panY;
        const scale = fitScale * zoom;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(layer, imageX, imageY, worldWidth * scale, worldHeight * scale);

        // Damage heat above the map raster and below the cones/dots.  Screen
        // blending lets the two teams' glows add up where they traded damage.
        const heatLayers = heatLayersRef.current;
        if (heatLayers.length > 0) {
          context.save();
          context.globalCompositeOperation = 'screen';
          context.globalAlpha = 0.92;
          for (const heatLayer of heatLayers) {
            context.drawImage(heatLayer, imageX, imageY, worldWidth * scale, worldHeight * scale);
          }
          context.restore();
        }

        toScreen = (x, y) => ({
          x: imageX + (x - bounds.minX) * scale,
          y: imageY + (bounds.maxY - y) * scale
        });
      }

      const players = radarRef.current?.players ?? [];
      const poses = posesRef.current;
      const seen = new Set<number>();
      const easing = 1 - Math.exp(-dt * 11);

      for (const player of players) {
        seen.add(player.num);
        let pose = poses.get(player.num);
        if (!pose) {
          pose = {
            x: player.x,
            y: player.y,
            yaw: player.yaw,
            dead: player.dead,
            baseZ: Number.isFinite(player.z) ? player.z : 0,
            jump: 0,
            targetJump: 0
          };
          poses.set(player.num, pose);
        } else {
          const jump = Math.hypot(player.x - pose.x, player.y - pose.y);
          if (jump > 600 || !Number.isFinite(pose.x)) {
            pose.x = player.x;
            pose.y = player.y;
            pose.yaw = player.yaw;
            pose.baseZ = Number.isFinite(player.z) ? player.z : pose.baseZ;
            pose.jump = 0;
            pose.targetJump = 0;
          } else {
            pose.x += (player.x - pose.x) * easing;
            pose.y += (player.y - pose.y) * easing;
            let delta = ((player.yaw - pose.yaw + 540) % 360) - 180;
            if (!Number.isFinite(delta)) delta = 0;
            pose.yaw += delta * easing;
          }
          pose.dead = player.dead;
        }

        // Height above the last surface the player stood on.  The radar's
        // ground flag keeps stairs and slopes from being read as jumps; a
        // respawn/teleport snap resets the baseline earlier in this block.
        const z = Number.isFinite(player.z) ? player.z : pose.baseZ;
        if (player.g) {
          pose.baseZ = z;
          pose.targetJump = 0;
        } else {
          pose.targetJump = Math.min(220, Math.max(0, z - pose.baseZ));
        }
        const jumpEase = 1 - Math.exp(-dt * (pose.targetJump > pose.jump ? 12 : 5));
        pose.jump += (pose.targetJump - pose.jump) * jumpEase;
        if (!Number.isFinite(pose.jump) || pose.jump < 0.4) pose.jump = 0;
      }
      for (const num of poses.keys()) {
        if (!seen.has(num)) poses.delete(num);
      }

      if (!toScreen) {
        dotsRef.current = [];
        frame = requestAnimationFrame(draw);
        return;
      }

      const teams = teamsRef.current;
      const fovRadians = (Math.max(1, fovRef.current) * Math.PI) / 180;
      const halfFov = fovRadians / 2;
      const dotRadius = Math.max(2.8, Math.min(width, height) * 0.019);
      const coneRadius = Math.max(18, Math.min(width, height) * 0.15);
      const hits: DotHit[] = [];
      const ordered = players
        .map(player => player.num)
        .sort((a, b) => {
          if (a === highlightRef.current) return 1;
          if (b === highlightRef.current) return -1;
          return a - b;
        });

      // Cones first so the dots stay legible on top of each other.
      for (const num of ordered) {
        const pose = poses.get(num);
        if (!pose || pose.dead) continue;
        const point = toScreen(pose.x, pose.y);
        if (point.x < -20 || point.y < -20 || point.x > width + 20 || point.y > height + 20) continue;
        const tone = playerTone(num, teams.get(num));
        const followed = num === highlightRef.current;
        const angle = (-pose.yaw * Math.PI) / 180;
        // No outline: the wedge starts readable at the player and fades out
        // slowly with distance, so only the viewing direction stays visible.
        const fade = context.createRadialGradient(
          point.x, point.y, 0,
          point.x, point.y, coneRadius
        );
        fade.addColorStop(0, toneColor(tone, followed ? 0.7 : 0.59));
        fade.addColorStop(0.35, toneColor(tone, followed ? 0.48 : 0.4));
        fade.addColorStop(0.75, toneColor(tone, followed ? 0.18 : 0.15));
        fade.addColorStop(1, toneColor(tone, 0));
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.arc(point.x, point.y, coneRadius, angle - halfFov, angle + halfFov);
        context.closePath();
        context.save();
        // A light blur removes the last hard edge of the wedge.
        context.filter = 'blur(0.8px)';
        context.fillStyle = fade;
        context.fill();
        context.restore();
      }

      // Movement trails from the demo scan.  The past is solid and fades into
      // the current dot; the future is dashed, dimmer and fades away from it,
      // so the same player's two directions read apart at minimap size.
      const liveTime = radarRef.current?.time ?? 0;
      if (liveTime && (trailsPastRef.current || trailsFutureRef.current)) {
        const trailSamples = trailsRef.current;
        const scale = Math.min(width, height);
        const trailWidth = Math.max(1.25, Math.min(3.2, scale * 0.005));
        const dashSize = Math.max(3, Math.min(8, scale * 0.012));

        for (const num of ordered) {
          const pose = poses.get(num);
          if (!pose || pose.dead) continue;
          if (trailsFollowOnlyRef.current && num !== highlightRef.current) continue;
          const samples = trailSamples.get(num);
          if (!samples || samples.length === 0) continue;
          const tone = playerTone(num, teams.get(num));
          const dot = toScreen(pose.x, pose.y);

          if (trailsPastRef.current) {
            const points: Array<{ x: number; y: number; t: number; wx: number; wy: number }> = [];
            for (const sample of samples) {
              if (sample.t > liveTime) break;
              if (sample.t < liveTime - TRAIL_LENGTH_MS) continue;
              const point = toScreen(sample.x, sample.y);
              points.push({ x: point.x, y: point.y, t: sample.t, wx: sample.x, wy: sample.y });
            }
            points.push({ x: dot.x, y: dot.y, t: liveTime, wx: pose.x, wy: pose.y });
            context.setLineDash([]);
            for (let i = 1; i < points.length; i++) {
              if (points[i].t - points[i - 1].t > TRAIL_GAP_MS) continue;
              if (Math.hypot(points[i].wx - points[i - 1].wx, points[i].wy - points[i - 1].wy) > TRAIL_SNAP_UNITS) {
                continue;
              }
              const fade = 1 - Math.max(0, liveTime - points[i].t) / TRAIL_LENGTH_MS;
              context.beginPath();
              context.moveTo(points[i - 1].x, points[i - 1].y);
              context.lineTo(points[i].x, points[i].y);
              context.strokeStyle = toneColor(tone, 0.1 + 0.6 * fade);
              context.lineWidth = trailWidth * (0.7 + 0.3 * fade);
              context.stroke();
            }
          }

          if (trailsFutureRef.current) {
            const points: Array<{ x: number; y: number; t: number; wx: number; wy: number }> = [
              { x: dot.x, y: dot.y, t: liveTime, wx: pose.x, wy: pose.y }
            ];
            for (const sample of samples) {
              if (sample.t <= liveTime) continue;
              if (sample.t > liveTime + TRAIL_LENGTH_MS) break;
              const point = toScreen(sample.x, sample.y);
              points.push({ x: point.x, y: point.y, t: sample.t, wx: sample.x, wy: sample.y });
            }
            if (points.length > 1) {
              const head = points[0];
              const tail = points[points.length - 1];
              // One path keeps the dash pattern continuous; the spatial
              // gradient dims it toward the recorded end.
              const fade = context.createLinearGradient(head.x, head.y, tail.x, tail.y);
              fade.addColorStop(0, toneColor(tone, 0.45));
              fade.addColorStop(1, toneColor(tone, 0.1));
              context.strokeStyle = fade;
              context.lineWidth = trailWidth * 0.85;
              context.setLineDash([dashSize, dashSize * 1.4]);
              context.beginPath();
              let pen = false;
              for (let i = 1; i < points.length; i++) {
                if (
                  points[i].t - points[i - 1].t > TRAIL_GAP_MS ||
                  Math.hypot(points[i].wx - points[i - 1].wx, points[i].wy - points[i - 1].wy) > TRAIL_SNAP_UNITS
                ) {
                  pen = false;
                  continue;
                }
                if (!pen) {
                  context.moveTo(points[i - 1].x, points[i - 1].y);
                  pen = true;
                }
                context.lineTo(points[i].x, points[i].y);
              }
              context.stroke();
              context.setLineDash([]);
            }
          }
        }
        context.lineWidth = 1;
        context.globalAlpha = 1;
      }

      for (const num of ordered) {
        const pose = poses.get(num);
        if (!pose) continue;
        const point = toScreen(pose.x, pose.y);
        if (point.x < -12 || point.y < -12 || point.x > width + 12 || point.y > height + 12) continue;
        const tone = playerTone(num, teams.get(num));
        const color = toneColor(tone);
        const followed = num === highlightRef.current;
        const strength = pose.dead ? 0 : Math.min(1, pose.jump / 90);
        const radius = (followed ? dotRadius + 1.1 : dotRadius) + strength * 0.6;
        hits.push({ num, x: point.x, y: point.y });

        // Airborne effect: a glow and an outward pulse whose reach and opacity
        // grow with the height above the launch surface.  Normal jumps are
        // clearly visible; Force Jump peaks at the strongest ring.
        if (strength > 0.05) {
          // A translucent aura makes the elevation readable at a glance; its
          // size and opacity grow with the jump height.
          context.beginPath();
          context.arc(point.x, point.y, radius + 3 + strength * 6, 0, Math.PI * 2);
          context.fillStyle = color;
          context.globalAlpha = 0.05 + 0.12 * strength;
          context.fill();

          context.beginPath();
          context.arc(point.x, point.y, radius + 1.5 + strength * 2.5, 0, Math.PI * 2);
          context.strokeStyle = color;
          context.globalAlpha = 0.18 + 0.22 * strength;
          context.lineWidth = 0.9 + 0.9 * strength;
          context.stroke();

          // A white lift ring reads on both the light floors and dark void;
          // its radius, weight and brightness all grow with the jump.
          context.beginPath();
          context.arc(point.x, point.y, radius + 3 + strength * 6, 0, Math.PI * 2);
          context.strokeStyle = 'rgba(255, 255, 255, 1)';
          context.globalAlpha = 0.09 + 0.2 * strength;
          context.lineWidth = 0.8 + 1.0 * strength;
          context.stroke();

          // The outward pulse is deliberately slow and faint; height is still
          // readable from the halo and rings without flashing at the player.
          const phase = ((now + num * 131) % 1600) / 1600;
          context.beginPath();
          context.arc(point.x, point.y, radius + 2 + phase * (6 + 10 * strength), 0, Math.PI * 2);
          context.strokeStyle = color;
          context.globalAlpha = (1 - phase) * (0.12 + 0.22 * strength);
          context.lineWidth = 0.9;
          context.stroke();
          context.globalAlpha = 1;
        }

        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.globalAlpha = pose.dead ? 0.38 : 1;
        context.fill();
        context.globalAlpha = 1;
        context.lineWidth = 1.25;
        context.strokeStyle = pose.dead ? 'rgba(8, 12, 17, 0.9)' : 'rgba(8, 12, 17, 0.72)';
        context.stroke();

        if (strength > 0.05) {
          context.beginPath();
          context.arc(point.x, point.y, radius * 0.55, 0, Math.PI * 2);
          context.fillStyle = 'rgba(255, 255, 255, 0.95)';
          context.globalAlpha = 0.06 + 0.16 * strength;
          context.fill();
          context.globalAlpha = 1;
        }

        if (followed) {
          // Follow highlight: a fixed white ring plus an amber pulse, so the
          // camera target is immediately distinct from every team tone.
          const pulse = 0.5 + 0.5 * Math.sin(now / 190);
          context.beginPath();
          context.arc(point.x, point.y, radius + 2.2, 0, Math.PI * 2);
          context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          context.lineWidth = 1.8;
          context.stroke();

          context.beginPath();
          context.arc(point.x, point.y, radius + 4.6 + pulse * 1.8, 0, Math.PI * 2);
          context.strokeStyle = 'rgba(242, 177, 52, 0.95)';
          context.lineWidth = 2;
          context.stroke();

          context.beginPath();
          context.arc(point.x, point.y, radius + 7.6 + pulse * 3.6, 0, Math.PI * 2);
          context.strokeStyle = `rgba(242, 177, 52, ${0.32 * (1 - pulse)})`;
          context.lineWidth = 1.2;
          context.stroke();
        }
      }

      dotsRef.current = hits;
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const dotAt = useCallback((clientX: number, clientY: number): DotHit | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: DotHit | null = null;
    let bestDistance = 15;
    for (const dot of dotsRef.current) {
      const distance = Math.hypot(dot.x - x, dot.y - y);
      if (distance < bestDistance) {
        best = dot;
        bestDistance = distance;
      }
    }
    return best;
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const element = event.currentTarget;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    element.setPointerCapture(event.pointerId);

    if (expandedRef.current && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const rect = element.getBoundingClientRect();
      const view = viewRef.current;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      pinchRef.current = {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        zoom: view.zoom,
        baseX: (midX - centerX - view.panX) / view.zoom + centerX,
        baseY: (midY - centerY - view.panY) / view.zoom + centerY
      };
      panRef.current = null;
      setDragging(false);
      return;
    }
    if (pointersRef.current.size > 2) return;

    const view = viewRef.current;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: false
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (expandedRef.current && pointersRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const rect = canvas.getBoundingClientRect();
      const pinch = pinchRef.current;
      const view = viewRef.current;
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.zoom * (distance / pinch.distance)));
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      view.zoom = zoom;
      view.panX = midX - centerX - (pinch.baseX - centerX) * zoom;
      view.panY = midY - centerY - (pinch.baseY - centerY) * zoom;
      clampView(rect.width, rect.height);
      event.preventDefault();
      return;
    }

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(dx, dy) > PAN_SLOP) {
      pan.moved = true;
      if (expandedRef.current) setDragging(true);
    }
    if (pan.moved && expandedRef.current) {
      const view = viewRef.current;
      view.panX = pan.panX + dx;
      view.panY = pan.panY + dy;
      clampView(canvas.clientWidth, canvas.clientHeight);
      event.preventDefault();
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setDragging(false);
    if (pan.moved) return;
    const hit = dotAt(event.clientX, event.clientY);
    if (hit) onFollowRef.current(hit.num);
    // Clicking the small map promotes it to the full stage.
    if (!expandedRef.current) onExpandRef.current();
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className={expanded ? 'minimap is-expanded' : 'minimap'}
      data-state={status}
      data-expanded={expanded ? '1' : undefined}
      data-dragging={dragging ? '1' : undefined}
      role={expanded ? undefined : 'button'}
      tabIndex={expanded ? undefined : 0}
      aria-label={expanded ? undefined : 'Open the top-down map'}
      title={
        expanded
          ? 'Map: drag to pan, scroll or pinch to zoom, click a player dot to follow'
          : 'Click to open the map'
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={event => {
        if (!expandedRef.current) return;
        if (viewRef.current.zoom > MIN_ZOOM + 0.001) {
          viewRef.current = { zoom: MIN_ZOOM, panX: 0, panY: 0 };
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, 2);
      }}
      onKeyDown={event => {
        if (!expandedRef.current && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onExpandRef.current();
        }
      }}
    >
      <canvas ref={canvasRef} className="minimap-canvas" aria-label="Top-down map with player positions" />
      {expanded && status === 'ready' ? (
        <div
          className="minimap-heat"
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onWheelCapture={event => event.stopPropagation()}
        >
          <label className="minimap-heat-row">
            <span>Heatmap</span>
            <select
              value={heatmap}
              onChange={event => onHeatmapChange(event.target.value as DamageHeatmapMode)}
            >
              {HEATMAP_MODES.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {heatmapKind(heatmap) && !heatmapIsTeam(heatmap) ? (
            <label className="minimap-heat-row">
              <span>Player</span>
              <select
                value={subject ?? ''}
                onChange={event => setHeatmapPlayer(Number(event.target.value))}
              >
                {heatmapPlayers.map(player => (
                  <option key={`${player.num}-${player.name}`} value={player.num}>
                    {stripColors(player.name) || `Client ${player.num}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {heatLegend ? (
            <div className="minimap-heat-legend">
              {heatLegend.empty ? (
                <span className="minimap-heat-empty">{heatLegend.empty}</span>
              ) : (
                <>
                  {heatLegend.rows.map(row => (
                    <span className="minimap-heat-key" key={row.label}>
                      <i style={{ background: row.color }} />
                      <span>{row.label}</span>
                      <b>{row.value}</b>
                    </span>
                  ))}
                  <span className="minimap-heat-empty">
                    {formatDamage(heatLegend.placed ?? 0)} of {formatDamage(heatLegend.total ?? 0)} damage placed
                  </span>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {status === 'ready' ? null : (
        <span className="minimap-note">{status === 'loading' ? 'Building map…' : 'Map image unavailable'}</span>
      )}
    </div>
  );
}
