import type { ScoreboardData } from '../types';

interface ScoreStripProps {
  data: ScoreboardData | null;
  elapsed: string;
  showScores: boolean;
  showTimer: boolean;
}

function stripColors(name: string): string {
  return name.replace(/\^[0-9a-zA-Z]/g, '').replace(/\^/g, '');
}

function scoreText(value: number): string {
  return value === -9999 || value < -1000 ? '—' : String(value);
}

export function ScoreStrip({ data, elapsed, showScores, showTimer }: ScoreStripProps) {
  if (!showScores && !showTimer) return null;

  const teamGame = !!data && data.gametype >= 6;
  const players = data
    ? [...data.players].sort((a, b) => b.score - a.score)
    : [];

  let left = '—';
  let leftLabel = 'Red';
  let right = '—';
  let rightLabel = 'Blue';
  let leftClass = 'red';
  let rightClass = 'blue';

  if (teamGame) {
    left = scoreText(data.scores1);
    right = scoreText(data.scores2);
  } else if (players.length > 0) {
    leftLabel = stripColors(players[0].name);
    left = String(players[0].score);
    leftClass = 'neutral';
    rightLabel = '';
    if (players.length > 1) {
      rightLabel = stripColors(players[1].name);
      right = String(players[1].score);
      rightClass = 'neutral';
    }
  } else {
    leftLabel = '';
    rightLabel = '';
  }

  return (
    <div className={showScores ? 'score-strip' : 'score-strip solo'} aria-label="Match scores">
      {showScores ? (
        <div className={`score-side ${leftClass}`}>
          {leftLabel ? <span className="score-name">{leftLabel}</span> : null}
          <strong>{left}</strong>
        </div>
      ) : null}
      {showTimer ? <div className="score-timer">{elapsed}</div> : null}
      {showScores && rightLabel ? (
        <div className={`score-side ${rightClass}`}>
          <span className="score-name">{rightLabel}</span>
          <strong>{right}</strong>
        </div>
      ) : null}
    </div>
  );
}
