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
    <div style={{
      display: "flex",
      gap: 8,
      padding: "8px 12px",
      marginTop: 4,
      marginBottom: 8,
    }}>
      <button
        type="button"
        onClick={() => dispatch("continue")}
        style={{
          flex: 1,
          background: "rgba(124, 140, 248, 0.2)",
          border: "1px solid rgba(124, 140, 248, 0.4)",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--dpf-accent)",
          cursor: "pointer",
        }}
      >
        {isLastStep ? "Finish Setup" : "Continue"}
      </button>
      <button
        type="button"
        onClick={() => dispatch("skip")}
        style={{
          background: "rgba(136, 136, 160, 0.15)",
          border: "1px solid rgba(136, 136, 160, 0.3)",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--dpf-muted)",
          cursor: "pointer",
        }}
      >
        Skip
      </button>
      <button
        type="button"
        onClick={() => dispatch("pause")}
        style={{
          background: "transparent",
          border: "1px solid rgba(136, 136, 160, 0.2)",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--dpf-muted)",
          cursor: "pointer",
        }}
      >
        Later
      </button>
    </div>
  );
}
