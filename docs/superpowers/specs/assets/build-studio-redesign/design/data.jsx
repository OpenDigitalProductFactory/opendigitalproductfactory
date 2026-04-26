// v2 data — outcome focused. Same realistic build, friendlier shape.

const BUILD = {
  title: "Tenant API key rotation",
  subtitle: "Let owners rotate API keys without losing access for live tenants.",
  requestedBy: "Maya Chen",
  requestedAt: "Today, 9:14am",
  branch: "feat/api-key-rotation",
  buildId: "fb_8a3c91",
};

// Steps in the package-delivery metaphor — only 5, very plain
const STEPS = [
  { id: "ideate", label: "Understanding",   verb: "We figured out what you want",        state: "done",     when: "9:18am" },
  { id: "plan",   label: "Planning",        verb: "We sketched how to build it",         state: "done",     when: "9:24am" },
  { id: "build",  label: "Building",        verb: "We wrote the code & tests",           state: "done",     when: "9:41am" },
  { id: "review", label: "Checking",        verb: "We're checking it works for you",     state: "active",   when: "now",    progress: 4, total: 6 },
  { id: "ship",   label: "Handover",        verb: "Awaiting your approval",              state: "waiting",  when: "—" },
];

// Conversation transcript — assistant + user
const CONVERSATION = [
  { role: "user", time: "9:14am",
    text: "We need a way for tenant owners to rotate their API keys without losing access. Current keys can't be rotated without downtime." },

  { role: "assistant", time: "9:15am",
    text: "Got it. Before I build, two quick clarifications:",
    choices: [
      { id: "grace", label: "Grace window for the old key", picked: "60 seconds",
        options: ["No grace — instant cut-off", "60 seconds", "5 minutes", "Custom…"] },
      { id: "scope", label: "Who can trigger a rotation?", picked: "Tenant owners only",
        options: ["Tenant owners only", "Owners + admins", "Anyone with the key"] },
    ] },

  { role: "user", time: "9:17am",
    text: "60 seconds and owners only. Also — please add an audit log entry for every rotation." },

  { role: "assistant", time: "9:18am",
    text: "Done. I'll record who rotated, when, and the old/new key IDs. Starting work now.",
    cards: [{ kind: "step", refStep: "ideate" }] },

  { role: "assistant", time: "9:24am",
    text: "Plan ready. I'll touch 4 files and add 2 fields to the database. Want to see what's in the plan?",
    cards: [{ kind: "plan-summary" }] },

  { role: "assistant", time: "9:41am",
    text: "Code is written. 5 files, 4 of them small. Tests are passing.",
    cards: [{ kind: "files-touched" }] },

  { role: "assistant", time: "9:46am",
    text: "I'm walking through the feature in the browser to make sure it works. Here's what I've checked so far:",
    cards: [{ kind: "verification-strip" }] },

  // Pending decision — the only thing the user MUST do
  { role: "assistant", time: "now", needsAction: true,
    text: "I'm ready to ship this. There's one thing I'd like you to look at before I do — a small public API change.",
    cards: [{ kind: "callout-decision" }] },
];

// What changed (used by side panel)
const FILES_TOUCHED = [
  { name: "API key handling",      detail: "We now refuse expired and revoked keys.",                  kind: "modified" },
  { name: "Rotation logic",        detail: "New code that swaps a key safely.",                        kind: "new"      },
  { name: "Tests for rotation",    detail: "Covers happy path, grace window, cross-tenant safety.",     kind: "new"      },
  { name: "Authentication routes", detail: "Added the rotate endpoint.",                                kind: "modified" },
  { name: "Database structure",    detail: "Stores when a key expires and when it was rotated out.",     kind: "modified" },
];

// Verification screenshots
const STORY_STEPS = [
  { idx: 1, title: "Open Settings",                        result: "passed", caption: "Maya signs in and lands on Settings → API Keys." },
  { idx: 2, title: "Find the existing key",                result: "passed", caption: "The current key is listed with its label and last-used date." },
  { idx: 3, title: "Click Rotate",                         result: "passed", caption: "A confirmation modal explains the 60-second grace window." },
  { idx: 4, title: "Confirm rotation",                     result: "passed", caption: "New key is generated and copyable in one click." },
  { idx: 5, title: "Old key keeps working briefly",        result: "running", caption: "Verifying calls with the old key still succeed for 60 seconds." },
  { idx: 6, title: "Old key is rejected after grace",      result: "queued",  caption: "Will hit the API again after 60s and expect a 401." },
];

// Plain-English schema summary
const SCHEMA_PLAIN = {
  area: "API keys",
  changes: [
    { verb: "We now remember", what: "when a key expires",         detail: "Lets us cut off old keys after the grace period." },
    { verb: "We now remember", what: "when a key was rotated out", detail: "So the audit log can show the timeline." },
    { verb: "We made it faster", what: "to look up active keys",   detail: "Added an index so login isn't slowed by old keys." },
  ],
  risks: [
    { level: "low", text: "Existing keys are unaffected — both new fields are optional." },
  ],
};

const ACCEPTANCE = [
  { id: "A", text: "Owners can rotate from Settings without downtime.",        met: true  },
  { id: "B", text: "Old keys stop working after 60 seconds.",                  met: true  },
  { id: "C", text: "Cross-tenant rotation is forbidden.",                      met: true  },
  { id: "D", text: "Rotating during traffic loses < 0.1% of requests.",        met: false, note: "Verifying now in the browser — step 5/6." },
  { id: "E", text: "Audit log records rotated_by, when, old/new key IDs.",     met: false, note: "Logged but I want you to confirm the wording." },
];

const PENDING_APPROVALS = [
  { id: "ap1", title: "Tenant API key rotation",       step: "Ship to production",   risk: "medium", age: "now",  current: true },
  { id: "ap2", title: "Apple Pay at checkout",         step: "Open upstream PR",     risk: "low",    age: "11m" },
  { id: "ap3", title: "Customer assistant escalation", step: "Ship to production",   risk: "high",   age: "1h" },
];

const RISK = {
  low:    { color: "var(--success)", label: "low risk" },
  medium: { color: "var(--warning)", label: "medium" },
  high:   { color: "var(--error)",   label: "high" },
};

// Tiny inline icon set (kept simple)
const Icon = ({ name, size = 16, stroke = 1.6 }) => {
  const w = (kids) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kids}</svg>
  );
  switch (name) {
    case "check":   return w(<path d="M3 8.5l3 3 7-7"/>);
    case "x":       return w(<><path d="M3.5 3.5l9 9"/><path d="M12.5 3.5l-9 9"/></>);
    case "send":    return w(<path d="M2.5 8h11M9 4l5 4-5 4"/>);
    case "arrow-r": return w(<path d="M4 8h8M9 5l3 3-3 3"/>);
    case "spark":   return w(<path d="M8 2l1.5 4 4 1.5-4 1.5L8 13l-1.5-4-4-1.5 4-1.5z"/>);
    case "package": return w(<><path d="M8 1.5l5.5 3v6L8 13.5 2.5 10.5v-6z"/><path d="M8 7.5L13.5 4.5M8 7.5L2.5 4.5M8 7.5v6"/></>);
    case "user":    return w(<><circle cx="8" cy="6" r="2.5"/><path d="M3 13.5c1-2.5 3-3.5 5-3.5s4 1 5 3.5"/></>);
    case "moon":    return w(<path d="M13 9.5A6 6 0 1 1 6.5 3a5 5 0 0 0 6.5 6.5z"/>);
    case "sun":     return w(<><circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1.1 1.1M12 12l1 1M3 13l1.1-1.1M12 4l1-1"/></>);
    case "drill":   return w(<path d="M5 4l6 4-6 4z"/>);
    case "edit":    return w(<><path d="M11 2.5l2.5 2.5L5 13.5H2.5V11z"/></>);
    case "more":    return w(<><circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/></>);
    case "branch":  return w(<><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 5v6"/><path d="M12 7.5c0 2-2 3-4 3.5"/></>);
    case "warn":    return w(<><path d="M8 2l6.5 11h-13z"/><path d="M8 7v3"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/></>);
    case "image":   return w(<><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="7" r="1"/><path d="M2 11l3.5-3 3 2.5 2-1.5L14 12"/></>);
    case "table":   return w(<><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 7h12M2 10h12M6 3v10"/></>);
    case "play":    return w(<path d="M5 3v10l8-5z" fill="currentColor"/>);
    case "pause":   return w(<><rect x="4" y="3" width="2.5" height="10"/><rect x="9.5" y="3" width="2.5" height="10"/></>);
    default: return null;
  }
};

// One persona for the AI — name + soft mark
const Persona = ({ size = 28 }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%",
    background: "linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 60%, var(--text)) 100%)",
    display: "grid", placeItems: "center",
    color: "var(--bg)", fontWeight: 700, fontSize: size * 0.42,
    boxShadow: "0 1px 0 rgba(255,255,255,0.4) inset, 0 4px 10px color-mix(in srgb, var(--accent) 30%, transparent)",
    flexShrink: 0,
  }}>D</div>
);

const UserMark = ({ size = 28, name = "Maya" }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%",
    background: "var(--surface-3)", color: "var(--text)",
    border: "1px solid var(--border)",
    display: "grid", placeItems: "center",
    fontWeight: 600, fontSize: size * 0.42, flexShrink: 0,
  }}>{name[0]}</div>
);

Object.assign(window, {
  BUILD, STEPS, CONVERSATION, FILES_TOUCHED, STORY_STEPS, SCHEMA_PLAIN, ACCEPTANCE, PENDING_APPROVALS, RISK,
  Icon, Persona, UserMark,
});
