import type { DemoSummary } from '../types';
import { formatTime } from '../format';

interface DemoSummaryViewProps {
  summary: DemoSummary | null;
}

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

export function DemoSummaryView({ summary }: DemoSummaryViewProps) {
  if (!summary || summary.games.length === 0) return null;

  return (
    <section className="demo-summary" aria-label="Demo summary">
      <h3>Demo summary</h3>
      {summary.games.map((game, index) => {
        const players = [...game.players]
          .filter(player => player.team !== 3 || player.kills > 0 || player.deaths > 0)
          .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
        return (
          <div className="demo-game" key={`${game.map}-${game.startTime}-${index}`}>
            <div className="demo-game-head">
              <strong>{game.map}</strong>
              <span>{formatTime(game.duration)} played</span>
              {game.levelTime > 0 ? <span className="muted">match clock {formatTime(game.levelTime)}</span> : null}
            </div>
            {players.length === 0 ? (
              <p className="muted">No players were seen in this demo.</p>
            ) : (
              <table className="demo-summary-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Score</th>
                    <th className="num">Deaths</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map(player => (
                    <tr key={`${player.num}-${player.firstSeen}-${player.name}`} className={player.left ? 'left' : undefined}>
                      <td title={stripColors(player.name)}>{stripColors(player.name)}</td>
                      <td className="num">{player.score}</td>
                      <td className="num">{player.deaths}</td>
                      <td>{player.left ? <span className="badge-left">left</span> : player.returned ? 'returned' : 'played'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {summary.games.some(game => game.eventOverflow) ? (
        <p className="fineprint">Some events were truncated from this very long demo.</p>
      ) : null}
    </section>
  );
}
