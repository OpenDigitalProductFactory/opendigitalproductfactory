import type {
  Acceptance,
  BuildSummary,
  FileTouched,
  Message,
  PendingApproval,
  SchemaPlain,
  Step,
  StoryStep,
} from "@/components/build-studio/types";

export const DEMO_BUILD: BuildSummary = {
  title: "Tenant API key rotation",
  subtitle: "Let owners rotate API keys without losing access for live tenants.",
  requestedBy: "Maya Chen",
  requestedAt: "Today, 9:14am",
  branch: "feat/api-key-rotation",
  buildId: "fb_8a3c91",
};

export const DEMO_STEPS: Step[] = [
  {
    id: "ideate",
    label: "Understanding",
    verb: "We figured out what you want",
    state: "done",
    when: "9:18am",
  },
  {
    id: "plan",
    label: "Planning",
    verb: "We sketched how to build it",
    state: "done",
    when: "9:24am",
  },
  {
    id: "build",
    label: "Building",
    verb: "We wrote the code & tests",
    state: "done",
    when: "9:41am",
  },
  {
    id: "review",
    label: "Checking",
    verb: "We're checking it works for you",
    state: "active",
    when: "now",
    progress: 4,
    total: 6,
  },
  {
    id: "ship",
    label: "Handover",
    verb: "Awaiting your approval",
    state: "waiting",
    when: "—",
  },
];

export const DEMO_CONVERSATION: Message[] = [
  {
    role: "user",
    time: "9:14am",
    text:
      "We need a way for tenant owners to rotate their API keys without losing access. Current keys can't be rotated without downtime.",
  },
  {
    role: "assistant",
    time: "9:15am",
    text: "Got it. Before I build, two quick clarifications:",
    choices: [
      {
        id: "grace",
        label: "Grace window for the old key",
        picked: "60 seconds",
        options: ["No grace — instant cut-off", "60 seconds", "5 minutes", "Custom…"],
      },
      {
        id: "scope",
        label: "Who can trigger a rotation?",
        picked: "Tenant owners only",
        options: ["Tenant owners only", "Owners + admins", "Anyone with the key"],
      },
    ],
  },
  {
    role: "user",
    time: "9:17am",
    text:
      "60 seconds and owners only. Also — please add an audit log entry for every rotation.",
  },
  {
    role: "assistant",
    time: "9:18am",
    text:
      "Done. I'll record who rotated, when, and the old/new key IDs. Starting work now.",
    cards: [{ kind: "step-ref", refStep: "ideate" }],
  },
  {
    role: "assistant",
    time: "9:24am",
    text:
      "Plan ready. I'll touch 4 files and add 2 fields to the database. Want to see what's in the plan?",
    cards: [{ kind: "plan-summary" }],
  },
  {
    role: "assistant",
    time: "9:41am",
    text: "Code is written. 5 files, 4 of them small. Tests are passing.",
    cards: [{ kind: "files-touched" }],
  },
  {
    role: "assistant",
    time: "9:46am",
    text:
      "I'm walking through the feature in the browser to make sure it works. Here's what I've checked so far:",
    cards: [{ kind: "verification-strip" }],
  },
  {
    role: "assistant",
    time: "now",
    needsAction: true,
    text:
      "I'm ready to ship this. There's one thing I'd like you to look at before I do — a small public API change.",
    cards: [{ kind: "callout-decision" }],
  },
];

export const DEMO_FILES_TOUCHED: FileTouched[] = [
  {
    name: "API key handling",
    detail: "We now refuse expired and revoked keys.",
    kind: "modified",
  },
  {
    name: "Rotation logic",
    detail: "New code that swaps a key safely.",
    kind: "new",
  },
  {
    name: "Tests for rotation",
    detail: "Covers happy path, grace window, cross-tenant safety.",
    kind: "new",
  },
  {
    name: "Authentication routes",
    detail: "Added the rotate endpoint.",
    kind: "modified",
  },
  {
    name: "Database structure",
    detail: "Stores when a key expires and when it was rotated out.",
    kind: "modified",
  },
];

export const DEMO_STORY_STEPS: StoryStep[] = [
  {
    idx: 1,
    title: "Open Settings",
    result: "passed",
    caption: "Maya signs in and lands on Settings → API Keys.",
  },
  {
    idx: 2,
    title: "Find the existing key",
    result: "passed",
    caption: "The current key is listed with its label and last-used date.",
  },
  {
    idx: 3,
    title: "Click Rotate",
    result: "passed",
    caption: "A confirmation modal explains the 60-second grace window.",
  },
  {
    idx: 4,
    title: "Confirm rotation",
    result: "passed",
    caption: "New key is generated and copyable in one click.",
  },
  {
    idx: 5,
    title: "Old key keeps working briefly",
    result: "running",
    caption: "Verifying calls with the old key still succeed for 60 seconds.",
  },
  {
    idx: 6,
    title: "Old key is rejected after grace",
    result: "queued",
    caption: "Will hit the API again after 60s and expect a 401.",
  },
];

export const DEMO_SCHEMA_PLAIN: SchemaPlain = {
  area: "API keys",
  changes: [
    {
      verb: "We now remember",
      what: "when a key expires",
      detail: "Lets us cut off old keys after the grace period.",
    },
    {
      verb: "We now remember",
      what: "when a key was rotated out",
      detail: "So the audit log can show the timeline.",
    },
    {
      verb: "We made it faster",
      what: "to look up active keys",
      detail: "Added an index so login isn't slowed by old keys.",
    },
  ],
  risks: [
    {
      level: "low",
      text: "Existing keys are unaffected — both new fields are optional.",
    },
  ],
};

export const DEMO_ACCEPTANCE: Acceptance[] = [
  {
    id: "A",
    text: "Owners can rotate from Settings without downtime.",
    met: true,
  },
  {
    id: "B",
    text: "Old keys stop working after 60 seconds.",
    met: true,
  },
  {
    id: "C",
    text: "Cross-tenant rotation is forbidden.",
    met: true,
  },
  {
    id: "D",
    text: "Rotating during traffic loses < 0.1% of requests.",
    met: false,
    note: "Verifying now in the browser — step 5/6.",
  },
  {
    id: "E",
    text: "Audit log records rotated_by, when, old/new key IDs.",
    met: false,
    note: "Logged but I want you to confirm the wording.",
  },
];

export const DEMO_PENDING_APPROVALS: PendingApproval[] = [
  {
    id: "ap1",
    title: "Tenant API key rotation",
    step: "Ship to production",
    risk: "medium",
    age: "now",
    current: true,
  },
  {
    id: "ap2",
    title: "Apple Pay at checkout",
    step: "Open upstream PR",
    risk: "low",
    age: "11m",
  },
  {
    id: "ap3",
    title: "Customer assistant escalation",
    step: "Ship to production",
    risk: "high",
    age: "1h",
  },
];
