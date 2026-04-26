// Header bar — build title, progress chip, theme toggle, primary action

const HeaderBar = ({ theme, setTheme }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 22px",
                background: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 28, height: 28, borderRadius: 8,
                    background: "var(--text)", color: "var(--bg)",
                    display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, letterSpacing: -0.5 }}>
        DPF
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Build Studio</div>
    </div>

    <div style={{ height: 22, width: 1, background: "var(--border)" }}/>

    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: -0.15 }}>{BUILD.title}</span>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)", padding: "1px 8px",
                      background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6 }}>
          {BUILD.branch}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Requested by {BUILD.requestedBy} · {BUILD.requestedAt}
      </div>
    </div>

    <span style={{ flex: 1 }}/>

    {/* Pending approval pill — folded into the header */}
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 8px",
                  background: "color-mix(in srgb, var(--warning) 12%, var(--surface-1))",
                  border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border))",
                  borderRadius: 999, fontSize: 12.5 }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--warning)",
                     color: "var(--surface-1)", display: "grid", placeItems: "center" }}>
        <Icon name="warn" size={11} stroke={2.4}/>
      </span>
      <span style={{ color: "var(--text)", fontWeight: 600 }}>1 thing waiting on you</span>
      <span style={{ color: "var(--muted)" }}>·</span>
      <span style={{ color: "var(--muted)" }}>2 more across builds</span>
    </div>

    <button className="btn-ghost btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme" style={{ padding: 8 }}>
      <Icon name={theme === "dark" ? "sun" : "moon"} size={14}/>
    </button>
    <button className="btn-ghost btn" style={{ padding: 8 }}><Icon name="pause" size={14}/></button>
    <button className="btn-accent btn" style={{ fontSize: 13 }}>Approve & ship</button>
  </div>
);

window.HeaderBar = HeaderBar;
