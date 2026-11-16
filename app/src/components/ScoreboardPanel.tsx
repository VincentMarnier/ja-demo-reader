import type { ScoreboardData, ScoreboardPlayer } from '../types';

interface ScoreboardPanelProps {
  data: ScoreboardData | null;
  followClient: number | null;
  onFollow: (clientNum: number) => void;
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
  return (
    <div className={`scoreboard-row team-${player.team}`}>
      <span className="scoreboard-score" title={`${player.score} kills / ${player.deaths} deaths`}>
        {player.score}<small>/{player.deaths}</small>
      </span>
      <span className="scoreboard-name" title={stripColors(player.name)}>
        {stripColors(player.name)}
      </span>
      <span className="scoreboard-ping">{player.ping > 0 ? `${player.ping} ms` : '—'}</span>
      <button
        type="button"
        className={props.following ? 'follow-btn active' : 'follow-btn'}
        onClick={() => props.onFollow(player.num)}
        aria-pressed={props.following}
      >
        {props.following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

export function ScoreboardPanel({ data, followClient, onFollow, onDemoCamera }: ScoreboardPanelProps) {
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
        <button type="button" className="ghost small" onClick={onDemoCamera}>
          Demo camera
        </button>
      </div>

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
                onFollow={onFollow}
              />
            ))}
          </section>
        ))
      )}

      <p className="scoreboard-hint">Follow a player for a first-person model camera, or use Free cam.</p>
    </aside>
  );
}
