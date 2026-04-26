// Artifact pane — preview-first, with verification + plain schema as drill-ins

const ArtifactTabs = ({ value, onChange }) => {
  const tabs = [
    { id: "preview",  label: "Preview",      icon: "play" },
    { id: "verification", label: "Walkthrough", icon: "image" },
    { id: "schema",   label: "What changed", icon: "table" },
    { id: "diff",     label: "The change",   icon: "drill" },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "var(--surface-2)",
                  border: "1px solid var(--border)", borderRadius: 10 }}>
      {tabs.map(t => {
        const sel = value === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px",
                     fontSize: 12.5, fontWeight: sel ? 600 : 500,
                     background: sel ? "var(--surface-1)" : "transparent",
                     color: sel ? "var(--text)" : "var(--text-2)",
                     border: "1px solid " + (sel ? "var(--border)" : "transparent"),
                     borderRadius: 8 }}>
            <Icon name={t.icon} size={12}/> {t.label}
          </button>
        );
      })}
    </div>
  );
};

const PreviewFrame = () => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 22, gap: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div className="mono" style={{ flex: 1, padding: "7px 12px", background: "var(--surface-1)",
                    border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text-2)" }}>
        sandbox.dpf.local / settings / api-keys
      </div>
      <span className="chip" style={{ "--c": "var(--success)" }}><span className="chip-dot pulse"/>live</span>
    </div>
    <div style={{ flex: 1, background: "var(--surface-1)", border: "1px solid var(--border)",
                  borderRadius: 14, boxShadow: "var(--shadow-card)", overflow: "hidden",
                  display: "flex", flexDirection: "column" }}>
      {/* Mock app header */}
      <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--border)",
                    display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--accent)" }}/>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Acme · Settings</span>
        <span style={{ flex: 1 }}/>
        <UserMark size={26}/>
      </div>
      <div style={{ padding: "20px 28px", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Settings</div>
          <h2 style={{ margin: "4px 0 4px", fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>API Keys</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>Rotate or revoke keys for Acme. Old keys stay valid for 60 seconds after rotation.</p>
        </div>
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {[
            { label: "Production",  last: "Last used 4 minutes ago",  state: "active" },
            { label: "CI / build",  last: "Last used today, 8:14am", state: "active" },
            { label: "Old read-only key", last: "Rotated out · expires in 47s", state: "expiring" },
          ].map((k, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center",
                          padding: "14px 18px", borderBottom: i < 2 ? "1px solid var(--border)" : "none", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{k.last}</div>
              </div>
              {k.state === "expiring" ? (
                <span className="chip" style={{ "--c": "var(--warning)" }}><span className="chip-dot pulse"/>grace window</span>
              ) : (
                <span className="chip" style={{ "--c": "var(--success)" }}><span className="chip-dot"/>active</span>
              )}
              <button className="btn" style={{ fontSize: 12 }}>Rotate</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const VerificationView = () => (
  <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 22, gap: 14, overflow: "auto" }}>
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        Walking through it as a real user
      </div>
      <h2 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>
        4 of 6 steps confirmed
      </h2>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
      {STORY_STEPS.map(s => {
        const c = s.result === "passed" ? "var(--success)"
                : s.result === "running" ? "var(--accent)"
                : s.result === "failed" ? "var(--error)" : "var(--border-strong)";
        return (
          <div key={s.idx} style={{ background: "var(--surface-1)", border: "1px solid var(--border)",
                        borderRadius: 12, overflow: "hidden", boxShadow: "var(--shadow-card)" }}>
            <div style={{ aspectRatio: "16/10", background: "var(--surface-3)",
                          backgroundImage: `repeating-linear-gradient(135deg, var(--surface-2) 0 14px, var(--surface-3) 14px 28px)`,
                          position: "relative" }}>
              <div style={{ position: "absolute", top: 8, left: 8, fontSize: 11, fontWeight: 700,
                            color: c, background: "var(--surface-1)", padding: "2px 8px", borderRadius: 6,
                            border: `1px solid ${c}` }}>
                Step {s.idx}
              </div>
              {s.result === "running" && <div className="shimmer" style={{ position: "absolute", inset: 0, opacity: 0.45 }}/>}
              {s.result === "passed" && (
                <div style={{ position: "absolute", bottom: 8, right: 8, color: c, opacity: 0.65 }}>
                  <Icon name="check" size={20} stroke={2.4}/>
                </div>
              )}
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4, lineHeight: 1.45 }}>{s.caption}</div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const SchemaPlainView = () => (
  <div style={{ height: "100%", overflow: "auto", padding: "22px 28px" }}>
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        What changed in your data
      </div>
      <h2 style={{ margin: "4px 0 4px", fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>{SCHEMA_PLAIN.area}</h2>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "0 0 18px" }}>
        Plain-English summary of the database changes. Drill in for the technical schema.
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        {SCHEMA_PLAIN.changes.map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14,
                       padding: 16, background: "var(--surface-1)", border: "1px solid var(--border)",
                       borderRadius: 12, boxShadow: "var(--shadow-card)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)",
                          color: "var(--accent)", display: "grid", placeItems: "center" }}>
              <Icon name="spark" size={16}/>
            </div>
            <div>
              <div style={{ fontSize: 14.5, color: "var(--text)" }}>
                <span style={{ color: "var(--muted)", fontWeight: 500 }}>{c.verb}</span>{" "}
                <strong>{c.what}</strong>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 3 }}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, padding: 14, background: "color-mix(in srgb, var(--success) 10%, var(--surface-1))",
                    border: "1px solid color-mix(in srgb, var(--success) 30%, var(--border))", borderRadius: 12,
                    display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Icon name="check" size={16}/>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--success)" }}>{SCHEMA_PLAIN.risks[0].level} risk</div>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>{SCHEMA_PLAIN.risks[0].text}</div>
        </div>
      </div>

      <button className="btn" style={{ marginTop: 16, fontSize: 12.5 }}>
        <Icon name="drill" size={11}/> See the technical schema
      </button>
    </div>
  </div>
);

const DiffDrillIn = () => (
  <div style={{ height: "100%", padding: 22, display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }}>
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        The change you flagged
      </div>
      <h2 style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>
        How the API responds when a key has expired
      </h2>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700,
                      color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Before</div>
        <div className="mono" style={{ padding: 14, fontSize: 12.5, color: "var(--text-2)", whiteSpace: "pre", lineHeight: 1.7 }}>
{`if (!key)            
  return null;        

// caller sees a generic 401`}
        </div>
      </div>
      <div style={{ background: "color-mix(in srgb, var(--success) 6%, var(--surface-1))",
                    border: "1px solid color-mix(in srgb, var(--success) 30%, var(--border))",
                    borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700,
                      color: "var(--success)", textTransform: "uppercase", letterSpacing: 0.6 }}>After</div>
        <div className="mono" style={{ padding: 14, fontSize: 12.5, color: "var(--text)", whiteSpace: "pre", lineHeight: 1.7 }}>
{`if (!key || key.revokedAt)
  return null;
if (key.expiresAt < now)
  return { error: "expired" };`}
        </div>
      </div>
    </div>

    <div style={{ padding: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12 }}>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>
        <strong>What it means for clients:</strong> integrations now receive a clear <code className="mono">"expired"</code> signal
        instead of a generic 401, so they can tell the user to refresh their key. Old integrations still see a failure — they just
        don't get the new helpful detail.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button className="btn-accent btn">Approve & ship</button>
        <button className="btn">Request changes</button>
      </div>
    </div>
  </div>
);

const ArtifactPane = ({ view, setView }) => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%",
                background: "var(--surface-2)", borderLeft: "1px solid var(--border)" }}>
    <div style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)",
                  background: "var(--surface-1)", display: "flex", alignItems: "center", gap: 10 }}>
      <ArtifactTabs value={view} onChange={setView}/>
      <span style={{ flex: 1 }}/>
      <button className="btn-ghost btn" style={{ fontSize: 12 }}><Icon name="more" size={14}/></button>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {view === "preview"      && <PreviewFrame/>}
      {view === "verification" && <VerificationView/>}
      {view === "schema"       && <SchemaPlainView/>}
      {view === "diff"         && <DiffDrillIn/>}
    </div>
  </div>
);

window.ArtifactPane = ArtifactPane;
