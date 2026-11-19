import { useEffect, useMemo, useRef, useState } from 'react';
import type { DemoGameSummary } from '../types';
import type { MinimapImage } from '../map/bsp';
import { loadMapImage } from '../map/mapImage';
import {
  buildDamageHeatmapSource,
  combinedMax,
  hasDamagePositions,
  playerDamageTotals,
  playerTeams,
  rasterizeHeatmap,
  teamDamageTotals,
  type DamageHeatmapMode,
  type DamageHeatmapSource
} from '../map/damageHeatmap';
import { heatmapCanvas, teamHeatmapCanvas, TEAM_HEAT_HUE } from '../map/heatmapCanvas';
import { playerTone, toneColor } from '../map/playerTone';
import { stripColors } from '../saber';

interface DamageHeatmapPanelProps {
  game: DemoGameSummary;
  /** Selected player seed for the player layers. */
  num: number;
  mapName: string;
  files: readonly Blob[];
  /**
   * Layers to show.  Team layers belong to the Damage over time view and
   * player layers to player detail, so each caller passes its own pair; all
   * four are the default.
   */
  modes?: readonly DamageHeatmapMode[];
  /** When set, player layers only count damage between `num` and this client. */
  opponent?: number | null;
}

const CARDS: ReadonlyArray<{ mode: DamageHeatmapMode; label: string }> = [
  { mode: 'team-given', label: 'Team damage given' },
  { mode: 'team-received', label: 'Team damage received' },
  { mode: 'player-given', label: 'Player damage given' },
  { mode: 'player-received', label: 'Player damage received' }
];

function formatDamage(value: number): string {
  return Math.round(value).toLocaleString();
}

function playerName(game: DemoGameSummary, num: number): string {
  let found: DemoGameSummary['players'][number] | undefined;
  for (const player of game.players) {
    if (player.num === num) found = player;
  }
  return found ? stripColors(found.name) || `Client ${num}` : `Client ${num}`;
}

/**
 * One map preview: the generated raster dimmed under the heat layer(s).  The
 * heat canvases have the grid resolution and are scaled up by the browser, so
 * the splat stays soft at every map size.
 */
function HeatmapPreview(props: {
  image: MinimapImage;
  source: DamageHeatmapSource;
  mode: DamageHeatmapMode;
  num: number;
  team: number;
  opponent?: number;
}) {
  const { image, source, mode, num, team, opponent } = props;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0a1018';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const raster = document.createElement('canvas');
    raster.width = image.width;
    raster.height = image.height;
    const rasterContext = raster.getContext('2d');
    if (!rasterContext) return;
    rasterContext.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    context.globalAlpha = 0.6;
    context.imageSmoothingEnabled = true;
    context.drawImage(raster, 0, 0);
    context.globalAlpha = 1;

    const teamMode = mode === 'team-given' || mode === 'team-received';
    const kind = mode === 'team-given' || mode === 'player-given' ? 'given' : 'received';
    const layers: HTMLCanvasElement[] = [];
    if (teamMode) {
      const first = rasterizeHeatmap(source, kind, { team: 1 });
      const second = rasterizeHeatmap(source, kind, { team: 2 });
      const max = combinedMax([first, second]);
      const layer = teamHeatmapCanvas(first, second, max);
      if (layer) layers.push(layer);
    } else {
      const grid = rasterizeHeatmap(source, kind, { player: num, opponent });
      const tone = playerTone(num, team);
      const layer = heatmapCanvas(grid, grid.max, tone.h, tone.s);
      if (layer) layers.push(layer);
    }

    context.save();
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = 0.95;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    for (const layer of layers) {
      context.drawImage(layer, 0, 0, canvas.width, canvas.height);
    }
    context.restore();
  }, [image, source, mode, num, team, opponent]);

  return <canvas ref={ref} className="detail-heat-canvas" aria-hidden="true" />;
}

export function DamageHeatmapPanel({
  game,
  num,
  mapName,
  files,
  modes = CARDS.map(card => card.mode),
  opponent
}: DamageHeatmapPanelProps) {
  const opponentNum = opponent ?? undefined;
  const [image, setImage] = useState<MinimapImage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  // The summary's game map is authoritative; fall back to the wizard's map.
  const map = game.map || mapName;

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setStatus('loading');
    void loadMapImage(map, files).then(result => {
      if (cancelled) return;
      setImage(result);
      setStatus(result ? 'ready' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [map, files]);

  const source = useMemo(
    () => (image ? buildDamageHeatmapSource(game, image.bounds) : null),
    [game, image]
  );

  const totals = useMemo(() => playerDamageTotals(game, num, opponentNum), [game, num, opponentNum]);
  const teams = useMemo(() => playerTeams(game), [game]);
  const team = teams.get(num) ?? 0;
  const hasPositions = useMemo(() => hasDamagePositions(game), [game]);

  if (status === 'loading') {
    return <p className="muted detail-empty">Building the damage heatmaps…</p>;
  }
  if (status === 'missing' || !image || !source) {
    return (
      <p className="muted detail-empty">
        The map image is unavailable, so the damage heatmaps cannot be placed. Add the map PK3
        in the map step to generate it.
      </p>
    );
  }
  if ((game.damages?.length ?? 0) === 0) {
    return <p className="muted detail-empty">No damage was recorded in this game.</p>;
  }
  if (!hasPositions) {
    return (
      <p className="muted detail-empty">
        This cached summary has no damage positions. Run Check map again to rescan the demo with
        the current engine and record where each damage instance happened.
      </p>
    );
  }

  const coverage = (mode: DamageHeatmapMode): string => {
    if (mode === 'team-given' || mode === 'team-received') {
      const placed = mode === 'team-given' ? source.givenDamage : source.receivedDamage;
      const total = mode === 'team-given' ? source.givenTotal : source.receivedTotal;
      return `${formatDamage(placed)} of ${formatDamage(total)} team damage placed`;
    }
    const placed = mode === 'player-given' ? totals.placedDealt : totals.placedReceived;
    const total = mode === 'player-given' ? totals.dealt : totals.received;
    return `${formatDamage(placed)} of ${formatDamage(total)} damage placed`;
  };

  const teamOnly = modes.every(mode => mode === 'team-given' || mode === 'team-received');
  const playerOnly = modes.every(mode => mode === 'player-given' || mode === 'player-received');

  const playerScope = opponentNum === undefined
    ? playerName(game, num)
    : `${playerName(game, num)} vs ${playerName(game, opponentNum)}`;

  return (
    <div className="detail-heat">
      <p className="muted detail-heat-note">
        {teamOnly
          ? "Positions come from the demo scan. Given is where each team's attacker stood; received is where the victim stood. Damage outside the recorded POV's PVS has no position and is left out of the map."
          : "Positions come from the demo scan. Given is where the attacker stood; received is where the victim stood. Damage outside the recorded POV's PVS has no position and is left out of the map."}
        {playerOnly
          ? opponentNum === undefined
            ? ' Follows the player selected above.'
            : ` Only damage between ${playerName(game, num)} and ${playerName(game, opponentNum)} is shown.`
          : ''}
      </p>
      <div className="detail-heat-grid">
        {CARDS.filter(card => modes.includes(card.mode)).map(card => {
          const teamCard = card.mode === 'team-given' || card.mode === 'team-received';
          const kind = card.mode.endsWith('given') ? 'given' : 'received';
          const playerCaption =
            opponentNum === undefined
              ? playerScope
              : kind === 'given'
                ? `${playerName(game, num)} → ${playerName(game, opponentNum)}`
                : `${playerName(game, opponentNum)} → ${playerName(game, num)}`;
          return (
            <figure className="detail-heat-card" key={card.mode}>
              <figcaption className="detail-heat-head">
                <strong>{card.label}</strong>
                <span>{teamCard ? 'Red and blue teams' : playerCaption}</span>
              </figcaption>
              <HeatmapPreview
                image={image}
                source={source}
                mode={card.mode}
                num={num}
                team={team}
                opponent={opponentNum}
              />
              <div className="detail-heat-legend">
                {teamCard ? (
                  [1, 2].map(id => {
                    const counts = teamDamageTotals(game, id);
                    return (
                      <span className="detail-heat-key" key={id}>
                        <i style={{ background: `hsl(${TEAM_HEAT_HUE[id]} 88% 62%)` }} />
                        <span>Team {id}</span>
                        <b>{formatDamage(kind === 'given' ? counts.given : counts.received)}</b>
                      </span>
                    );
                  })
                ) : (
                  <span className="detail-heat-key">
                    <i style={{ background: toneColor(playerTone(num, team)) }} />
                    <span>{kind === 'given' ? 'dealt' : 'taken'}</span>
                    <b>{formatDamage(kind === 'given' ? totals.dealt : totals.received)}</b>
                  </span>
                )}
                <span className="detail-heat-coverage">{coverage(card.mode)}</span>
              </div>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
