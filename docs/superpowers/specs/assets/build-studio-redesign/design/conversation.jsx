// Conversation pane — transcript with embedded cards & inline choices
const { useState } = React;

const ChoiceCard = ({ choice }) => {
  const [picked, setPicked] = useState(choice.picked);
  return (
    <div style={{ marginTop: 8, padding: 12, background: "var(--surface-2)",
                  border: "1px solid var(--border)", borderRadius: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{choice.label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {choice.options.map(o => {
          const sel = picked === o;
          return (
            <button key={o} onClick={() => setPicked(o)}
              style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: sel ? 600 : 500,
                       background: sel ? "var(--text)" : "var(--surface-1)",
                       color: sel ? "var(--bg)" : "var(--text-2)",
                       border: `1px solid ${sel ? "var(--text)" : "var(--border)"}`,
                       borderRadius: 999, transition: "all 120ms" }}>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const PlanSummaryCard = () => (
  <div style={{ marginTop: 8, padding: 14, background: "var(--surface-2)",
                border: "1px solid var(--border)", borderRadius: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
      The plan
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      {[
        "Add a way to expire & revoke keys safely",
        "Build the rotate action with a 60-second grace window",
        "Add tests covering the happy path and edge cases",
        "Wire it into the Settings → API Keys screen",
        "Record every rotation in the audit log",
      ].map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 10, fontSize: 13.5, color: "var(--text)" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--surface-3)",
                         display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600,
                         color: "var(--muted)", flexShrink: 0 }}>{i + 1}</span>
          {s}
        </div>
      ))}
    </div>
    <button className="btn" style={{ marginTop: 10, fontSize: 12 }}>
      <Icon name="drill" size={11}/> See the technical plan
    </button>
  </div>
);

const FilesTouchedCard = () => (
  <div style={{ marginTop: 8, padding: 14, background: "var(--surface-2)",
                border: "1px solid var(--border)", borderRadius: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
      What I touched · 5 files
    </div>
    <div style={{ display: "grid", gap: 4 }}>
      {FILES_TOUCHED.map(f => (
        <div key={f.name} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center",
                      padding: "6px 4px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                         background: f.kind === "new" ? "color-mix(in srgb, var(--success) 14%, var(--surface-1))" : "color-mix(in srgb, var(--warning) 14%, var(--surface-1))",
                         color: f.kind === "new" ? "var(--success)" : "var(--warning)",
                         border: `1px solid color-mix(in srgb, ${f.kind === "new" ? "var(--success)" : "var(--warning)"} 30%, var(--border))` }}>
            {f.kind}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{f.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{f.detail}</div>
          </div>
        </div>
      ))}
    </div>
    <button className="btn" style={{ marginTop: 10, fontSize: 12 }}>
      <Icon name="drill" size={11}/> See the diff
    </button>
  </div>
);

const VerificationStripCard = ({ onOpen }) => (
  <div style={{ marginTop: 8, padding: 14, background: "var(--surface-2)",
                border: "1px solid var(--border)", borderRadius: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        Walking through the feature
      </span>
      <span style={{ flex: 1 }}/>
      <span style={{ fontSize: 12, color: "var(--success)", fontWeight: 600 }}>4 of 6 working</span>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
      {STORY_STEPS.map(s => {
        const c = s.result === "passed" ? "var(--success)"
                : s.result === "running" ? "var(--accent)"
                : s.result === "failed" ? "var(--error)" : "var(--border-strong)";
        return (
          <div key={s.idx} style={{ aspectRatio: "1.4/1", borderRadius: 6,
                        background: "var(--surface-3)", border: `1px solid ${c}`, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 4, left: 4, fontSize: 9, fontWeight: 700,
                          color: c, background: "var(--surface-1)", padding: "1px 4px", borderRadius: 3 }}>
              {String(s.idx).padStart(2, "0")}
            </div>
            {s.result === "running" && <div className="shimmer" style={{ position: "absolute", inset: 0, opacity: 0.4 }}/>}
            {s.result === "passed" && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: c, opacity: 0.5 }}>
                <Icon name="check" size={16} stroke={2.4}/>
              </div>
            )}
          </div>
        );
      })}
    </div>
    <button onClick={onOpen} className="btn" style={{ marginTop: 10, fontSize: 12 }}>
      <Icon name="image" size={11}/> See screenshots
    </button>
  </div>
);

const DecisionCard = ({ onOpen }) => (
  <div style={{ marginTop: 10, padding: 14,
                background: "color-mix(in srgb, var(--warning) 10%, var(--surface-1))",
                border: "1px solid color-mix(in srgb, var(--warning) 40%, var(--border))",
                borderRadius: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <Icon name="warn" size={14}/>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        Needs your eye
      </span>
    </div>
    <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.5, marginBottom: 10 }}>
      I changed how the API responds when a key has expired — clients will see a structured error instead of a 401.
      It's safer, but technically a public API change. <strong>OK to ship?</strong>
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button className="btn-accent btn">Approve & ship</button>
      <button className="btn">Request changes</button>
      <button onClick={onOpen} className="btn-ghost btn"><Icon name="drill" size={11}/> See the change</button>
    </div>
  </div>
);

const StepRefCard = ({ stepId }) => {
  const s = STEPS.find(x => x.id === stepId);
  return (
    <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "5px 10px 5px 8px", background: "var(--surface-2)",
                  border: "1px solid var(--border)", borderRadius: 999, fontSize: 12 }}>
      <Icon name="package" size={12}/>
      <span style={{ color: "var(--muted)" }}>Started</span>
      <span style={{ fontWeight: 600 }}>{s.label}</span>
    </div>
  );
};

const Bubble = ({ msg, onOpenArtifact }) => {
  const isUser = msg.role === "user";
  return (
    <div className="slide-up" style={{ display: "flex", gap: 12, padding: "10px 22px",
                  background: msg.needsAction ? "color-mix(in srgb, var(--warning) 5%, transparent)" : "transparent" }}>
      <div style={{ paddingTop: 2 }}>
        {isUser ? <UserMark size={28}/> : <Persona size={28}/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {isUser ? "Maya" : "DPF"}
          </span>
          {!isUser && <span style={{ fontSize: 11, color: "var(--muted)" }}>your build assistant</span>}
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{msg.time}</span>
        </div>
        <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>{msg.text}</div>

        {msg.choices && msg.choices.map(c => <ChoiceCard key={c.id} choice={c}/>)}

        {msg.cards && msg.cards.map((card, i) => {
          if (card.kind === "step")              return <StepRefCard key={i} stepId={card.refStep}/>;
          if (card.kind === "plan-summary")      return <PlanSummaryCard key={i}/>;
          if (card.kind === "files-touched")     return <FilesTouchedCard key={i}/>;
          if (card.kind === "verification-strip")return <VerificationStripCard key={i} onOpen={() => onOpenArtifact("verification")}/>;
          if (card.kind === "callout-decision")  return <DecisionCard key={i} onOpen={() => onOpenArtifact("diff")}/>;
          return null;
        })}
      </div>
    </div>
  );
};

const Composer = () => {
  const [val, setVal] = useState("");
  return (
    <div style={{ padding: "12px 22px 18px", background: "var(--bg)" }}>
      <div style={{ background: "var(--surface-1)", border: "1px solid var(--border)",
                    borderRadius: 14, padding: 10, boxShadow: "var(--shadow-card)" }}>
        <textarea
          value={val} onChange={e => setVal(e.target.value)}
          placeholder="Reply to DPF, or shape what to build next…"
          rows={2}
          style={{ width: "100%", border: "none", outline: "none", resize: "none",
                   background: "transparent", color: "var(--text)", fontSize: 14, lineHeight: 1.5,
                   padding: "4px 6px" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <button className="btn-ghost btn" style={{ fontSize: 12 }}>Suggest a change</button>
          <button className="btn-ghost btn" style={{ fontSize: 12 }}>Pause build</button>
          <span style={{ flex: 1 }}/>
          <button className="btn-primary btn" style={{ fontSize: 13 }}>
            Send <Icon name="send" size={12}/>
          </button>
        </div>
      </div>
    </div>
  );
};

const ConversationPane = ({ onOpenArtifact }) => (
  <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
    <div style={{ flex: 1, overflow: "auto", paddingTop: 14, paddingBottom: 8 }}>
      {CONVERSATION.map((m, i) => <Bubble key={i} msg={m} onOpenArtifact={onOpenArtifact}/>)}
    </div>
    <Composer/>
  </div>
);

window.ConversationPane = ConversationPane;
