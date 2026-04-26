// Step tracker — package delivery metaphor. Horizontal pill train.

const Step = ({ step, idx, last }) => {
  const isDone = step.state === "done";
  const isActive = step.state === "active";
  const isWaiting = step.state === "waiting";
  const c = isDone ? "var(--success)" : isActive ? "var(--accent)" : isWaiting ? "var(--warning)" : "var(--muted)";
  const fillBg = isDone ? "var(--success)"
              : isActive ? "var(--accent)"
              : isWaiting ? "color-mix(in srgb, var(--warning) 30%, var(--surface-1))"
              : "var(--surface-1)";
  return (
    <div style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", width: 24, height: 24, borderRadius: "50%",
                        background: fillBg, border: `1.5px solid ${c}`,
                        display: "grid", placeItems: "center", color: isDone || isActive ? "var(--bg)" : c,
                        fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {isDone ? <Icon name="check" size={13} stroke={2.4}/> : idx + 1}
            {isActive && (
              <span style={{ position: "absolute", inset: -4, borderRadius: "50%",
                             border: `2px solid ${c}`, opacity: 0.25 }}/>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: isDone || isActive ? "var(--text)" : "var(--text-2)",
                          letterSpacing: -0.1 }}>
              {step.label}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>
              {step.verb}{step.progress != null ? ` · ${step.progress} of ${step.total}` : ""} {isActive ? "" : `· ${step.when}`}
            </div>
          </div>
        </div>
      </div>
      {!last && (
        <div style={{ flex: "0 1 28px", minWidth: 14, height: 1.5,
                      background: isDone ? "var(--success)" : "var(--border)", marginLeft: 6, marginRight: 6 }}/>
      )}
    </div>
  );
};

const StepTracker = () => (
  <div style={{ display: "flex", alignItems: "center", padding: "14px 22px",
                background: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
    {STEPS.map((s, i) => <Step key={s.id} step={s} idx={i} last={i === STEPS.length - 1}/>)}
  </div>
);

window.StepTracker = StepTracker;
