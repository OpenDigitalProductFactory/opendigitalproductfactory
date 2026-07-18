# AI Overseer Persona & Attribution Contract — design decision

- **BI:** BI-7D29937E (EP-COWORKER-INTERACTIVITY)
- **Status:** Draft for deliberation (2026-07-18)
- **Decision type:** architecture-decision (platform-wide persona/attribution contract) — escalated to a formal deliberation given diversity-of-thought stakes.
- **Teed up from:** the 2026-07-17 Needs-you / cognitive-load thread. The Attention Surface must attribute a recommendation to *someone* ("____ recommends: pay this bill"); choosing that voice forces an unresolved, platform-wide question.

## 1. Problem

The platform needs one contract for **how the AI overseer's identity is presented** and **how recommendations/actions are attributed to a voice** — adopted uniformly by the Attention Surface and every coworker surface. Today there is no such contract, and the substrate contradicts itself.

### 1a. The overseer identity diverges across three live sources

| Source | What it says the COO is |
|---|---|
| `prompts/route-persona/coo.prompt.md` | **Named "Jiminy"** (`displayName: Jiminy`; *"You are Jiminy… the user's conscience and right-hand"*) — a Pinocchio-cricket *conscience* framing. |
| In-code `/workspace` system prompt (`apps/web/lib/tak/agent-routing.ts`, `ROUTE_AGENT_MAP["/workspace"]`, the `FALLBACK_ENTRY`) | An un-named *"decisive executor"* COO — a different character than the prompt file. |
| DB `AGENT_IDENTITY_OVERRIDES` (`packages/db/src/agent-identity.ts`) | Forces the UI label **"COO"** (role-title only), overriding "Jiminy". |

So the UI shows "COO," the persona file thinks it is "Jiminy," and a third system prompt gives it a contradictory personality. The founder-stated stance recorded on the BI — *"the COO is intentionally NOT given a human name… naming takes a step too far in personifying AI"* — is currently true only by accident (the DB label winning), while a named human-ish persona ships one layer down.

### 1b. Attribution voice is inconsistent across surfaces

| Surface | Voice | Identity shown |
|---|---|---|
| Attention "Needs you" inbox (`apps/web/lib/attention/*`) | Neutral | Source label ("AI decision", "Approval"); "a coworker proposed…"; **no author field** on `AttentionItem` |
| Coworker chat bubbles / busy state | Role-named | Job title from `AGENT_NAME_MAP` + first-letter avatar + a distinct provider/model badge |
| Coworker profile / proactivity | First-person, role | "…how I follow up" |
| Marketing drafts / skill proposals | **Raw agentId leak** | "Drafted by marketing-specialist", "via {agentId}" |
| Agent proposals / decision cards | Unattributed / institutional | "The platform recommends…" |

Three conventions coexist (role-name vs raw-agentId vs anonymous; first-person coworker vs institutional platform voice; plus the separate engine/model badge).

## 2. What is already settled (non-negotiable inputs)

- **`never-fabricate`** (commandment) and **`schema-honesty-over-aspirational-naming`** (core) — authored by the founder. No implied human accountability, no false sentience, honest labels.
- **Persona-voice layer** (`2026-05-19-persona-voice-layer-wwtd-design.md`): *"not a personality chatbot… not an imitation layer… voice is a presentation layer; it does not change decision logic or authority."*
- **Proactivity policy** (`2026-06-29`): the proactivity dial changes persistence/timing/escalation/spend, **never authority**.
- **WWMD vs WWWD non-inheritance** (`2026-05-31-perspective-aware-voice-design.md`): a customer org must not silently inherit the platform's voice/identity.
- **Overseer doctrine** (`2026-06-22-build-studio-overseer-ux-design.md`, and PR #2480's Build Studio "overseer default" — one plain status + one next action, internal identifiers demoted): the human is an *overseer*; the AI is a governed custodian, not a passive status wall.
- **Attribution spine** (`2026-06-20-authenticated-work-attribution…`): every action is attributable to a specific `(install × human × client × session)` identity — the machine truth beneath any friendly label.

**Consistent founder direction:** AI is presented as a *governed, honestly-labeled coworker/custodian* — not an imitation of a human, never fabricating, never self-granting authority, always attributable.

## 3. The decision

**How should the platform present its AI overseer's identity and attribute recommendations — resolving the Jiminy / COO / executor divergence — balancing warmth and legibility for non-technical owners against the anthropomorphization risk the founder flagged?**

### Option A — Role-only (retire Jiminy)
The overseer is *"your COO"* (role title), never a human name. Retire the "Jiminy" persona; reconcile prompt file + in-code prompt + DB to one role-based identity. Attribution is role-based everywhere ("Your COO recommends", "Your bookkeeper drafted this").
- **For:** lowest anthropomorphization; cleanest fit with `never-fabricate` / anti-imitation; one source of truth.
- **Against:** colder for non-technical owners; discards an existing, evocative persona; a role title can still be over-trusted.

### Option B — Named persona (Jiminy canonical)
"Jiminy" becomes the one canonical overseer identity across all surfaces, with explicit anthropomorphization guardrails (always AI-labeled, model badge visible, no implied human accountability/sentience).
- **For:** warm, memorable, reduces cognitive load; a single relationship anchor.
- **Against:** highest personification risk (the exact failure the founder guards against); a name implies a person and accountability the system can't hold; harder to keep honest.

### Option C — Hybrid (role primary, name optional)
Role title *"your COO"* is the primary label and the attribution voice everywhere; a persona name may exist but is de-emphasized / opt-in and never the default byline.
- **For:** reconciles the divergence toward role-based without a hard retirement; lets warmth be an owner choice.
- **Against:** keeps two identities alive (ongoing drift risk); "optional name" is a weaker contract to enforce.

## 4. Cross-cutting requirements (any option)

1. **One attribution source of truth** — collapse `AGENT_NAME_MAP` / DB overrides / prompt-file names into a single resolver; no raw-agentId ever reaches the UI.
2. **Add an author to `AttentionItem`** so "Needs you" items can be attributed under the chosen contract instead of "a coworker".
3. **Overseer-speaks vs specialist-speaks** — when the COO funnels to a specialist (`delegates_to` AGT-100/101/102), decide single-voice vs named-specialist byline.
4. **Engine badge stays separate** from persona identity (provider/model badge ≠ who the coworker is).
5. **Honest guardrails**, whichever option: AI-labeled, no fabricated confidence, no self-granted authority, respects the per-triple trust ladder (L0→L3) and proactivity dial.

## 5. Deliverable

This doc + a recorded deliberation outcome → the platform-wide persona/attribution contract that the Attention Surface, coworker chat, proposals, and decision cards all adopt. Follow-on implementation BIs to reconcile the three identity sources and add the attention-author field.

## 6. Deliberation outcome (2026-07-18)

Grounded 3-branch debate panel (the governed `start_deliberation` run returned insufficient-evidence standalone — it can't ingest this artifact outside a task context, so a doc-seeded panel was run instead).

- **Advocate A (role-only):** adopt. *"The only contract that makes the founder's stated stance structurally true instead of accidental."* Confidence 0.72.
- **Advocate B (named Jiminy):** for B, but conceded it *"canonicalizes the exact failure the founder guards against"* and self-rated only **0.55** — the weakest own-advocate confidence.
- **Skeptic (founder-kernel guardian):** B ages worst (a *conscience*-named AI implies sentience — direct `never-fabricate` collision + reverses a recorded founder stance); C rots via drift (two identities alive = the very divergence this doc exists to fix). Verdict: **A, reframed**. Confidence 0.62.

**The reframe all three advocates glossed** (surfaced by the skeptic): the options debate *which persona mask*, but the honest byline for "____ recommends: pay this bill" is not a persona at all — it is the accountable **`(human × client × session)`** triple from the attribution spine, at a stated trust level. Even "your COO recommends" manufactures implied C-suite authority the system can't hold.

### Decision — RATIFIED (founder, 2026-07-18)
**Option A — role-only — reframed** (ratified). Implementation BIs filed under EP-COWORKER-INTERACTIVITY: (1) reconcile the three COO identity sources to one role-based identity, retiring "Jiminy"; (2) attribute recommendations to the authenticated `(human × client × session)` triple + add an author field to `AttentionItem`; (3) collapse to one attribution resolver and kill the raw-agentId leaks. The unanimous hard guardrail below is binding on all three.

**Option A — role-only — reframed:** retire "Jiminy"; the overseer's *presentation label* is its role ("your COO" / "your bookkeeper"), but the **byline attributes to the authenticated triple, not the persona** — e.g. *"AI-drafted for [owner] · pending your approval"* rather than *"your COO decided."* Persona is a thin label over the triple, never a substitute for it.

**Unanimous hard guardrail (any option):** no attribution string may imply an accountable actor the system cannot produce on demand from the attribution spine; every recommendation stays AI-labeled; the engine/model badge stays separate; no fabricated confidence; no self-granted authority (rides the L0→L3 trust ladder + proactivity dial).

Synthesis confidence ≈ 0.7 (branches converge A > C > B; the reframe strengthens A). This reverses the accidental status quo and sets a product stance, so it is recorded as a **recommendation for founder ratification**, not an executed decision.

## Design grounding

- Existing specs/plans reviewed: `docs/superpowers/specs/2026-04-27-coworker-persona-audit-design.md`, `2026-05-19-persona-voice-layer-wwtd-design.md`, `2026-06-22-build-studio-overseer-ux-design.md`, `2026-06-23-human-attention-surface-design.md`, `2026-06-20-authenticated-work-attribution-and-cross-install-coordination-design.md`, `2026-06-29-ai-coworker-proactivity-policy-design.md`.
- Current code substrate reviewed: `apps/web/lib/tak/agent-routing.ts`, `packages/db/src/agent-identity.ts`, `packages/db/data/agent_registry.json`, `prompts/route-persona/coo.prompt.md`, `apps/web/lib/attention/types.ts`, `apps/web/lib/governance/action-proposal-presentation.ts`.
- Source of truth: founder principles `never-fabricate` + `schema-honesty-over-aspirational-naming`, plus the persona-voice and attention-surface specs.
- Decision: escalated to a formal deliberation (this artifact); no code/schema change yet.
