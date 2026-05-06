"use client";

interface Props {
  error: string;
  onRetry?: () => void;
}

export default function ErrorBanner({ error, onRetry }: Props) {
  return (
    <div style={{ borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
      <p style={{ margin: 0 }}>{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="ui-btn ui-btn-outline-red" style={{ marginTop: "10px", fontSize: "0.75rem" }}>
          Retry
        </button>
      )}
    </div>
  );
}
