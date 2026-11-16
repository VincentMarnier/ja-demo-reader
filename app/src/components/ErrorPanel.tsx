interface ErrorPanelProps {
  message: string;
  logs: string[];
  onReload: () => void;
  onBack: () => void;
}

export function ErrorPanel({ message, logs, onReload, onBack }: ErrorPanelProps) {
  return (
    <div className="overlay">
      <div className="panel error-panel">
        <div className="eyebrow error">Error</div>
        <h2>Could not start the demo</h2>
        <pre className="error-message">{message}</pre>
        {logs.length ? (
          <details>
            <summary>Engine log ({logs.length} lines)</summary>
            <pre className="error-log">{logs.slice(-80).join('\n')}</pre>
          </details>
        ) : null}
        <div className="row">
          <button className="primary" onClick={onReload}>Reload player</button>
          <button className="ghost" onClick={onBack}>Back</button>
        </div>
      </div>
    </div>
  );
}
