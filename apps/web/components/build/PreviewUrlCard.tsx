// apps/web/components/build/PreviewUrlCard.tsx
"use client";

import { type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  buildId: string;
  phase: BuildPhase;
  sandboxPort: number | null;
};

// Copy handler is a plain DOM operation — no React state needed. The
// button label flips to "Copied" for ~2s via a vanilla setTimeout on
// the click target itself. Kept hookless so the component renders
// under renderToStaticMarkup for unit tests (this workspace has two
// React versions in play and the vitest runner can't call hooks
// without an environment alias).
function handleCopy(e: React.MouseEvent<HTMLButtonElement>, url: string): void {
  const btn = e.currentTarget;
  void navigator.clipboard.writeText(url).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = original; }, 2000);
  });
}

export function PreviewUrlCard({ buildId, phase, sandboxPort }: Props) {
  const isRunning = sandboxPort !== null && (phase === "build" || phase === "review" || phase === "ship");
  const hostUrl = sandboxPort !== null ? `http://localhost:${sandboxPort}` : null;

  if (!isRunning || !hostUrl) {
    return (
      <div
        data-testid="preview-url-card"
        data-build-id={buildId}
        className="flex-1 grid place-items-center bg-[var(--dpf-surface-2)] rounded-lg border border-[var(--dpf-border)]"
      >
        <div className="text-center p-8 max-w-sm">
          <div className="w-2 h-2 rounded-full bg-[var(--dpf-muted)] mx-auto mb-3 opacity-50" />
          <p className="text-sm text-[var(--dpf-muted)] leading-relaxed">
            {phase === "ideate" || phase === "plan"
              ? "Preview will be available once the Build phase starts."
              : phase === "complete"
              ? "Feature has been shipped."
              : "Sandbox is not running."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="preview-url-card"
      data-build-id={buildId}
      className="flex-1 grid place-items-center rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-dpf-sm"
    >
      <div className="text-center p-10 max-w-md">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-[var(--dpf-success)]" />
          <span className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Sandbox running</span>
        </div>
        <h3 className="text-lg font-semibold text-[var(--dpf-text)] mb-2">Preview in your browser</h3>
        <p className="text-xs text-[var(--dpf-muted)] leading-relaxed mb-6">
          Opens in a new tab so you can inspect the live sandbox with your real browser&rsquo;s devtools,
          extensions, and account.
        </p>
        <div className="flex items-stretch gap-2 justify-center">
          <a
            href={hostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded text-sm font-medium bg-[var(--dpf-accent)] text-[var(--dpf-accent-contrast,white)] hover:opacity-90 transition-opacity no-underline flex items-center gap-1"
          >
            Open {hostUrl}
            <span aria-hidden="true">&#8599;</span>
          </a>
          <button
            type="button"
            onClick={(e) => handleCopy(e, hostUrl)}
            className="px-3 py-2 rounded text-xs border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
            aria-label="Copy preview URL"
          >
            Copy URL
          </button>
        </div>
      </div>
    </div>
  );
}
