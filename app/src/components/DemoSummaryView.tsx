import { useState } from 'react';
import type { DemoSummary } from '../types';
import { formatTime } from '../format';
import { recordKills } from '../summary';
import { DemoTrendChart, TREND_METRICS } from './DemoTrendChart';
import type { TrendMetric } from './DemoTrendChart';
import { PlayerDetailView } from './PlayerDetailView';

interface DemoSummaryViewProps {
  summary: DemoSummary | null;
  /** Start the demo at an absolute demo time, in ms. */
  onPlayFrom?: (timeMs: number) => void;
  busy?: boolean;
  canPlay?: boolean;
}

type SummaryView = 'table' | 'player' | TrendMetric;

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

export function DemoSummaryView({ summary, onPlayFrom, busy, canPlay }: DemoSummaryViewProps) {
  const [view, setView] = useState<SummaryView>('table');

  if (!summary || summary.games.length === 0) return null;

  return (
    <section className="demo-summary" aria-label="Demo summary">
      <div className="demo-summary-head">
        <h3>Demo summary</h3>
        <select
          value={view}
          aria-label="Demo summary view"
          onChange={event => setView(event.target.value as SummaryView)}
        >
          <option value="table">Summary table</option>
          <option value="player">Player detail</option>
          {TREND_METRICS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <p className="fineprint demo-summary-note">
        Global score and damage count opponents positively and allies negatively; the per-player
        pairings stay raw.
      </p>
      {view === 'player' ? (
        <PlayerDetailView
          key={`${summary.first}-${summary.duration}`}
          summary={summary}
          onPlayFrom={onPlayFrom}
          busy={busy}
          canPlay={canPlay}
        />
      ) : (
        summary.games.map((game, index) => {
          const players = [...game.players]
            .filter(player => player.team !== 3 || player.kills > 0 || player.deaths > 0)
            .map(player => ({ player, kills: recordKills(game, player) }))
            .sort((a, b) => b.kills - a.kills || a.player.deaths - b.player.deaths);
          return (
            <div className="demo-game" key={`${game.map}-${game.startTime}-${index}`}>
              <div className="demo-game-head">
                <strong>{game.map}</strong>
                <span>{formatTime(game.duration)} played</span>
                {game.levelTime > 0 ? <span className="muted">match clock {formatTime(game.levelTime)}</span> : null}
              </div>
              {view !== 'table' ? (
                <DemoTrendChart
                  game={game}
                  metric={view}
                  onPlayFrom={onPlayFrom}
                  busy={busy}
                  canPlay={canPlay}
                />
              ) : players.length === 0 ? (
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
                    {players.map(({ player, kills }) => (
                      <tr key={`${player.num}-${player.firstSeen}-${player.name}`} className={player.left ? 'left' : undefined}>
                        <td title={stripColors(player.name)}>{stripColors(player.name)}</td>
                        <td className="num">{kills}</td>
                        <td className="num">{player.deaths}</td>
                        <td>{player.left ? <span className="badge-left">left</span> : player.returned ? 'returned' : 'played'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
      {summary.games.some(game => game.eventOverflow) ? (
        <p className="fineprint">Some events were truncated from this very long demo.</p>
      ) : null}
      {summary.games.some(game => game.vitalsOverflow) ? (
        <p className="fineprint">Some health samples were truncated from this very long demo.</p>
      ) : null}
      {summary.games.some(game => game.stancesOverflow) ? (
        <p className="fineprint">Some stance samples were truncated from this very long demo.</p>
      ) : null}
      {summary.games.some(game => game.damageOverflow) ? (
        <p className="fineprint">Some damage records were truncated from this very long demo.</p>
      ) : null}
      {summary.games.some(game => game.swingsOverflow) ? (
        <p className="fineprint">Some saber swings were truncated from this very long demo.</p>
      ) : null}
      {summary.games.some(game => game.saberHitOverflow) ? (
        <p className="fineprint">Some saber hits were truncated from this very long demo.</p>
      ) : null}
      {summary.games.some(game => game.blockOverflow) ? (
        <p className="fineprint">Some block outcomes were truncated from this very long demo.</p>
      ) : null}
    </section>
  );
}
