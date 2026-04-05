"use client";

/**
 * Inline action buttons rendered inside the coworker panel during setup.
 * Dispatches custom events that SetupOverlay listens for.
 */
export function SetupActionButtons({ isLastStep = false }: { isLastStep?: boolean }) {
  const dispatch = (action: string) => {
    document.dispatchEvent(new CustomEvent("setup-action", { detail: action }));
  };

  return (
    <div className="flex gap-2 px-3 py-2 mt-1 mb-2">
      <button
        type="button"
        onClick={() => dispatch("continue")}
        className="flex-1 rounded-md px-3 py-2 text-xs font-medium bg-[var(--dpf-accent)]/20 border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] cursor-pointer hover:bg-[var(--dpf-accent)]/30 focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 transition-colors"
      >
        {isLastStep ? "Finish Setup" : "Continue"}
      </button>
      <button
        type="button"
        onClick={() => dispatch("skip")}
        className="rounded-md px-3 py-2 text-xs text-[var(--dpf-muted)] bg-[var(--dpf-muted)]/10 border border-[var(--dpf-muted)]/25 cursor-pointer hover:bg-[var(--dpf-muted)]/20 focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 transition-colors"
      >
        Skip
      </button>
      <button
        type="button"
        onClick={() => dispatch("pause")}
        className="rounded-md px-3 py-2 text-xs text-[var(--dpf-muted)] bg-transparent border border-[var(--dpf-muted)]/15 cursor-pointer hover:bg-[var(--dpf-muted)]/10 focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2 transition-colors"
      >
        Later
      </button>
    </div>
  );
}
