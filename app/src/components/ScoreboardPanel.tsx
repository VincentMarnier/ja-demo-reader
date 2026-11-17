import type { ScoreboardData, ScoreboardPlayer } from '../types';

interface ScoreboardPanelProps {
  data: ScoreboardData | null;
  followClient: number | null;
  freeCam: boolean;
  pointerLocked: boolean;
  onFollow: (clientNum: number) => void;
  onToggleFreeCam: () => void;
  onCaptureMouse: () => void;
  onDemoCamera: () => void;
}

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

function teamLabel(team: number): string {
  if (team === 1) return 'Red';
  if (team === 2) return 'Blue';
  return 'Players';
}

function PlayerRow(props: {
  player: ScoreboardPlayer;
  following: boolean;
  onFollow: (clientNum: number) => void;
}) {
  const { player } = props;
  const known = player.health !== undefined;
  const health = player.health ?? 0;
  const armor = player.armor ?? 0;
  const dead = known && health <= 0;
  return (
    <div className={`scoreboard-row team-${player.team}${player.left ? ' left' : ''}`}>
      <span className="scoreboard-score" title={`${player.score} kills / ${player.deaths} deaths`}>
        {player.score}<small>/{player.deaths}</small>
      </span>
      <span className="scoreboard-identity">
        <span className="scoreboard-name" title={stripColors(player.name)}>
          {stripColors(player.name)}
          {player.left ? <small className="left-tag">left</small> : null}
        </span>
        <span
          className={`scoreboard-vitals${dead ? ' dead' : ''}${known ? '' : ' unknown'}`}
          title={!known ? 'Vitals not scanned yet' : dead ? 'Dead' : `${health} health / ${armor} armor`}
        >
          <span className="vitals-health">HP {known ? health : '—'}</span>
          <span className="vitals-armor">AP {known ? armor : '—'}</span>
        </span>
      </span>
      <span className="scoreboard-ping">{player.ping > 0 ? `${player.ping} ms` : '—'}</span>
      <button
        type="button"
        className={props.following ? 'follow-btn active' : 'follow-btn'}
        onClick={() => props.onFollow(player.num)}
        aria-pressed={props.following}
        disabled={player.left}
      >
        {props.following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

export function ScoreboardPanel(props: ScoreboardPanelProps) {
  const { data, followClient, freeCam } = props;
  const players = data
    ? [...data.players].filter(p => p.team !== 3 && p.name.length > 0).sort((a, b) => b.score - a.score)
    : [];

  const groups: Array<{ label: string; players: ScoreboardPlayer[] }> = [];
  if (data && data.gametype >= 6) {
    for (const team of [1, 2]) {
      const groupPlayers = players.filter(p => p.team === team);
      if (groupPlayers.length > 0) groups.push({ label: teamLabel(team), players: groupPlayers });
    }
    const other = players.filter(p => p.team !== 1 && p.team !== 2);
    if (other.length > 0) groups.push({ label: 'Players', players: other });
  } else if (players.length > 0) {
    groups.push({ label: 'Players', players });
  }

  return (
    <aside className="scoreboard-panel" aria-label="Scoreboard">
      <div className="scoreboard-head">
        <strong>Scoreboard</strong>
        <button
          type="button"
          className={freeCam ? 'follow-btn active' : 'follow-btn'}
          onClick={props.onToggleFreeCam}
          aria-pressed={freeCam}
          title="Move the camera freely with the free camera keys"
        >
          {freeCam ? 'Free cam on' : 'Free cam'}
        </button>
      </div>

      {freeCam || followClient !== null ? (
        <div className="scoreboard-tools">
          {freeCam ? (
            <button
              type="button"
              className={props.pointerLocked ? 'follow-btn active' : 'follow-btn'}
              onClick={props.onCaptureMouse}
            >
              {props.pointerLocked ? 'Mouse captured' : 'Capture mouse'}
            </button>
          ) : null}
          <button type="button" className="follow-btn" onClick={props.onDemoCamera}>
            Demo camera
          </button>
        </div>
      ) : null}

      {players.length === 0 ? (
        <p className="muted scoreboard-empty">Waiting for players…</p>
      ) : (
        groups.map(group => (
          <section key={group.label} className="scoreboard-group">
            <div className={`scoreboard-group-label ${group.label.toLowerCase()}`}>{group.label}</div>
            {group.players.map(player => (
              <PlayerRow
                key={player.num}
                player={player}
                following={followClient === player.num}
                onFollow={props.onFollow}
              />
            ))}
          </section>
        ))
      )}

      <p className="scoreboard-hint">Follow a player for a first-person model camera, or use Free cam.</p>
    </aside>
  );
}
