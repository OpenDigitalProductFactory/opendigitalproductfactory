# Agent Client Governance

DPF supports embedded AI coworkers and external coding clients such as Claude,
Codex, Grok, Antigravity, and customer-owned MCP agents. Trust does not come
from a client brand or from the client saying that it followed instructions.
Trust comes from layered controls and observed outcomes.

## The four governance altitudes

| Altitude | Purpose | Authoritative mechanism |
| --- | --- | --- |
| Instructions | Teach the agent how DPF works and how to make decisions | `AGENTS.md`, DPF skills, WWMD/WWWD/WSID |
| Client harness | Catch known procedural mistakes near the client | bootstrap conformance, hooks, worktree and lease guards |
| Server authority | Decide which actions DPF accepts | MCP token scope, agent grants, lifecycle hooks, evidence gates |
| Learning and trust | Decide when autonomy may widen | `DecisionShadowLedger`, `TrustState`, regulatory ceilings, governed playbooks |

Each layer solves a different failure class.

- Instructions are portable and expressive, but a client may misunderstand,
  omit, or override them.
- Client hooks provide fast feedback, but delivery and trust behavior differs by
  client and customer-owned agents may not install them.
- Server gates apply to every caller, but should be reserved for consequential
  transitions so normal work does not become bureaucratic.
- Trust learning improves autonomy over time, but only from reconciled outcomes;
  self-attestation is not an outcome.

## Which plane owns what

```mermaid
flowchart TD
  A["AGENTS.md + DPF skills"] --> B["Client bootstrap and hooks"]
  B --> C["MCP discovery, token scope, and grants"]
  C --> D["Consequential mutation policy"]
  D --> E["Evidence and outcome ledgers"]
  E --> F["Per-activity trust state"]
  F -->|proved lane| D
  F -->|missing evidence or ceiling| G["Attention / Work Case"]
```

Tool discovery and mutation acceptance are intentionally separate:

- Per-client conformance and progressive disclosure decide which tools a caller
  sees and whether grants permit the call.
- Consequential mutation policies decide whether the requested state change is
  supportable now.

A client can therefore possess `backlog_write` and still be denied when it tries
to mark unsupported work complete. The grant means “may attempt this class of
action,” not “every claim is true.”

## Evidence-earned completion

`BacklogItem.status="done"` is organizational truth. Agent callers must provide a
typed completion manifest citing evidence already recorded on the BI. The server
resolves ownership, freshness, polarity, and supersession before allowing the
transition.

Evidence requirements are proportional:

- documentation needs a review;
- verified-existing implementation needs source provenance plus a manual
  verification record;
- operational work needs a manual completion check; and
- new implementation needs source, tests, production build, and any applicable
  UX or migration evidence.

Inapplicable UX and migration dimensions require a concrete rationale. This is
less costly than forcing irrelevant tests and more trustworthy than silently
assuming that a missing record means “not applicable.”

Build Studio is not exempt. Its canonical `FeatureBuild` verification can
satisfy dimensions through an adapter, so evidence is reused rather than copied.

## Client identity and trust

Client identity is useful attribution:

- which client family and version connected;
- which token and human principal authorized the request;
- which coworker or task run acted; and
- which session or Work Capsule contained the work.

It is not authority. A new Antigravity, Grok, Codex, or customer agent receives
the same server policy. Measured trust is keyed to coworker, activity, and risk,
then bounded by regulation and intrinsic authority.

## Operator attention

The platform asks for attention only when attention changes the outcome:

- evidence is genuinely missing;
- a newer failure invalidates an older pass;
- repeated unsupported mutations suggest a runaway client;
- a regulatory or authority ceiling requires a human; or
- bounded autonomous recovery is exhausted.

The preferred interaction gives one plain-language reason and one recommended
next action. Raw activity, token, policy, and ledger identifiers remain behind
engineer-level disclosure.

## Adding another consequential gate

Before adding a gate:

1. verify the canonical record and policy do not already exist;
2. classify the transition’s reversibility and blast radius;
3. route real architectural alternatives through WWMD;
4. reuse `governedExecuteTool` rather than adding a client-specific server path;
5. reuse existing evidence, attention, and trust records;
6. provide shadow, enforce, and emergency-off rollout modes when compatibility
   risk warrants them; and
7. verify every supported client through the server, even if its local hooks are
   absent.

The default is not to gate everything. Server enforcement belongs at
organizational truth, irreversible state, external effect, regulatory floor, or
material authority-boundary transitions.
