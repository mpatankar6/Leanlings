import { useEffect, useState } from "react";

export type StepState = "pending" | "active" | "done" | "error";

export type Step = {
  label: string;
  state: StepState;
  detail?: string;
  /** 0–1 when the step can report how far along it is. */
  progress?: number;
  /** `performance.now()` timestamps. */
  startedAt?: number;
  endedAt?: number;
};

/** Startup checklist overlay. Styles live in index.html so they match the pre-JS loader. */
export function LoadingScreen({ steps, hidden }: { steps: Step[]; hidden: boolean }) {
  // Re-render while visible so elapsed times tick.
  const [, tick] = useState(0);
  useEffect(() => {
    if (hidden) return;
    const t = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(t);
  }, [hidden]);

  const failed = steps.some((s) => s.state === "error");
  const overall =
    steps.reduce((sum, s) => sum + (s.state === "done" ? 1 : s.state === "active" ? (s.progress ?? 0.15) : 0), 0) /
    steps.length;

  return (
    <div className={`loader ${hidden ? "hidden" : ""}`} aria-hidden={hidden}>
      <div className="loader-card" role="status" aria-live="polite">
        <div className="loader-title">
          <img src="/favicon.png" alt="" />
          <h1>Leanlings</h1>
        </div>
        <div className="loader-overall">
          <div style={{ width: `${Math.round(overall * 100)}%` }} />
        </div>
        <ul className="loader-steps">
          {steps.map((s) => (
            <li key={s.label} className={`loader-step ${s.state}`}>
              <span className="loader-icon">
                {s.state === "active" ? <span className="spinner" /> : s.state === "done" ? "✓" : s.state === "error" ? "✕" : "○"}
              </span>
              <span>{s.label}</span>
              <span className="loader-time">{elapsed(s)}</span>
              {s.detail && <span className="loader-detail">{s.detail}</span>}
              {s.state === "active" && s.progress !== undefined && (
                <span className="loader-bar">
                  <div style={{ width: `${Math.round(s.progress * 100)}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {failed && (
          <div className="loader-actions">
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}

function elapsed(s: Step): string {
  if (s.startedAt === undefined || s.state === "pending") return "";
  return `${(((s.endedAt ?? performance.now()) - s.startedAt) / 1000).toFixed(1)}s`;
}

declare global {
  interface Window {
    /** Set by the inline script in index.html while the bundle loads. */
    __bootStats?: { files: number; bytes: number; start: number };
  }
}

export function formatBytes(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}
