import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { loadMapImage } from '../map/mapImage';
import type { MapBounds } from '../map/bsp';
import type { RadarData, ScoreboardData } from '../types';

interface MinimapProps {
  mapName: string;
  /** The user's PK3 blobs; the map image is read straight from them. */
  files: readonly Blob[];
  radar: RadarData | null;
  scores: ScoreboardData | null;
  /** Horizontal field of view in degrees, matching the demo camera. */
  fov: number;
  /** Camera subject: the demo POV or the player the camera follows. */
  highlightClient: number | null;
  onFollow: (clientNum: number) => void;
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

/** FFA colours, used when the player has no red/blue team. */
const FREE_COLORS = [
  [38, 82, 58],
  [198, 78, 60],
  [152, 62, 52],
  [322, 72, 64],
  [18, 88, 58],
  [268, 64, 66],
  [178, 72, 52],
  [92, 62, 50],
  [350, 78, 62],
  [224, 66, 64]
] as const;

/**
 * Per-client tone inside a team colour.  Red stays warm and blue stays cool,
 * but eight fixed offsets and brightness steps make teammates easy to tell
 * apart at minimap size.
 */
const TEAM_TONE_HUE = [-9, 9, -15, 15, -4, 4, 12, -12] as const;
const TEAM_TONE_LIGHT = [62, 55, 69, 58, 65, 51, 71, 60] as const;

interface Tone {
  h: number;
  s: number;
  l: number;
}

function teamTone(num: number, baseHue: number, saturation: number): Tone {
  const tone = Math.abs(num) % TEAM_TONE_HUE.length;
  return {
    h: (baseHue + TEAM_TONE_HUE[tone] + 360) % 360,
    s: saturation,
    l: TEAM_TONE_LIGHT[tone]
  };
}

function playerTone(num: number, team: number | undefined): Tone {
  if (team === 1) return teamTone(num, 0, 78);
  if (team === 2) return teamTone(num, 212, 82);
  const color = FREE_COLORS[Math.abs(num) % FREE_COLORS.length];
  return { h: color[0], s: color[1], l: color[2] };
}

function toneColor(tone: Tone, alpha = 1): string {
  return alpha >= 1
    ? `hsl(${tone.h} ${tone.s}% ${tone.l}%)`
    : `hsla(${tone.h}, ${tone.s}%, ${tone.l}%, ${alpha})`;
}

export function Minimap({ mapName, files, radar, scores, fov, highlightClient, onFollow }: MinimapProps) {
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
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(mapName ? 'loading' : 'missing');

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
    posesRef.current.clear();
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
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [mapName, files]);

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
        const scale = Math.min(width / worldWidth, height / worldHeight) * 0.98;
        const offsetX = (width - worldWidth * scale) / 2;
        const offsetY = (height - worldHeight * scale) / 2;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(layer, offsetX, offsetY, worldWidth * scale, worldHeight * scale);
        toScreen = (x, y) => ({
          x: offsetX + (x - bounds.minX) * scale,
          y: offsetY + (bounds.maxY - y) * scale
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

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best: DotHit | null = null;
    let bestDistance = 15;
    for (const dot of dotsRef.current) {
      const distance = Math.hypot(dot.x - x, dot.y - y);
      if (distance < bestDistance) {
        best = dot;
        bestDistance = distance;
      }
    }
    if (best) onFollowRef.current(best.num);
  }, []);

  return (
    <div
      className="minimap"
      data-state={status}
      onClick={handleClick}
      title="Top-down map: click a player dot to follow"
    >
      <canvas ref={canvasRef} className="minimap-canvas" aria-label="Top-down map with player positions" />
      {status === 'ready' ? null : (
        <span className="minimap-note">{status === 'loading' ? 'Building map…' : 'Map image unavailable'}</span>
      )}
    </div>
  );
}
