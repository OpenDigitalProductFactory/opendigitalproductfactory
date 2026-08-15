# Design — CRM enrichment / competitive-intelligence coworker: skill, wiring, and hardening

Date: 2026-08-14. Composes with: BI-B2497DFB (proactive CRM enrichment — shipped),
BI-6D10EB1F (Market Research Analyst CI coworker — landed as a draft), BI-2D435AFC
(v1 own-website enrichment), EP-WORKROOM-COMMS (work rooms), EP-VST-001 (value-stream teams).

## Why this doc

The proactive-CRM-enrichment tools shipped (`propose_crm_enrichment` / `apply_crm_enrichment`)
and are functionally verified on the live install. But a live coworker **cannot yet drive the
loop autonomously** — the Customer Success Manager reported *"I don't have a web search tool
here."* This doc pins **why** (it is configuration + method, not missing capability), and
designs the small net-new work, grounded in how the market does public-source enrichment.

## The finding: this is a **skill + configuration**, not a new MCP feature or coworker

Substrate audit (origin/main). Almost everything already exists:

| Capability | Status |
|---|---|
| Web search / fetch / analyze MCP tools (`search_public_web`, `fetch_public_website`, `analyze_public_website_branding`, Brave-backed) | **Exists** — `public-web-design-pack.ts`, grant `web_search`, `requiresExternalAccess:true` |
| CRM enrichment write tools (`propose_/apply_crm_enrichment`) | **Shipped** — `crm-enrichment-pack.ts` |
| A coworker holding `web_search` + `crm_read` + `crm_write` | **Exists** — `customer-advisor` already holds all three (`workforce-seed.ts`) |
| A dedicated CI coworker (read-only CRM + web) | **Exists as a draft** — `market-research-analyst` (BI-6D10EB1F), `valueStream: explore`, bound to `/customer/opportunities` |
| establish/certify/promote paved road, skill runtime, WSID profession corpus | **Exists** |

**Why the live coworker still can't research.** Not grants — a **gate that is off** plus
**config**:
1. Web tools are `requiresExternalAccess:true`, visible only when the per-turn **external-access
   toggle** is on (`mcp-tools.ts:505`; `agent-coworker.ts` threads `externalAccessEnabled`).
2. The **Brave Search API key** must be set (`public-web-tools.ts` `getBraveSearchApiKey` →
   PlatformConfig `brave_search_api_key` or `BRAVE_SEARCH_API_KEY`, else
   `ExternalAccessNotConfiguredError`).
3. Possibly `buildPhases:["ideate"]` on the web tools scopes them away from CRM chat — **verify**.
4. The install's **AI model routing is currently blocked** (Azure OpenAI trust-evidence
   attestation) — no coworker turn runs at all right now.

**Net-new, in value order:** (a) one **`SKILL.md` playbook** teaching the method; (b) a **config
turn-on** pass; (c) optional **tool hardening** (the 4 market decisions the tools don't yet
enforce). None is a new MCP feature; only the skill is genuinely new intellectual content.

## Market-grounded design principles

Synthesized from Clay (waterfall/pay-per-match), Cognism (compliant sourcing + DNC),
Clearbit/HubSpot Breeze (confidence threshold gating overwrites), Apollo/ZoomInfo
(reconciliation, refresh cadence), People Data Labs, and agentic-research patterns
(Anthropic web-search + Citations API, Perplexity, Exa/Tavily/Firecrawl). Four decisions carry
the weight:

1. **Identity-resolution gate before any write.** The top trust risk is enriching a same-named
   *wrong* company. Resolve the anchor **domain-first, then name + geography + one corroborator**;
   the researched source must *agree on the anchor* before any field is harvested; emit a match
   score; write **nothing** below threshold — instead ask "is this the right company?" Ref: AWS
   Entity Resolution rule-based matching; Tilores (name normalization is not enough); Dataiku
   (human validation of the borderline band).

2. **Grounded-or-blank, with per-field provenance tuples.** Every field is
   `{value, source, confidence, retrievedAt, supportingPassage}` — never a bare string. The value
   must be *entailed by the cited passage* (guards the documented Perplexity "citation-answer
   mismatch"); abstain (leave blank) otherwise; constrain categoricals (industry) to a taxonomy
   enum. Ref: "Don't Hallucinate, Abstain" (arXiv); Anthropic Citations API (required citations on
   `search_result` blocks).

3. **Compliance bright line + risk tiers** — this *is* the platform's "data trust over
   growth-hacks" stance. **Never scrape LinkedIn (or any ToS-prohibited source) directly** — a LinkedIn URL is
   an *identifier* to resolve against public/licensed sources, never a page to harvest (hiQ v.
   LinkedIn: public scraping isn't CFAA but remains a ToS violation). Tier fields:
   **firmographic** (company site / registries / news → low-risk, auto-eligible) vs.
   **personal-contact** (email / mobile → gated: documented lawful basis, suppression-list check,
   jurisdiction awareness; GDPR/CCPA apply to public B2B personal data). Ref: Cognism GDPR posture
   + worldwide DNC screening; Unify B2B-data-compliance.

4. **Confidence-tiered human-in-the-loop: propose-a-diff, don't auto-commit.** High-confidence
   firmographic + no conflict → auto fill-if-blank; conflict / medium → the approval diff; low →
   abstain. Never overwrite a human-entered value. Our shipped `propose→apply` split already *is*
   this; the skill sets the thresholds. Ref: Apollo reconciliation; Default/ZoomInfo enrichment
   guides.

**Cross-cutting mechanic — the source waterfall (stop at first confident match):**
simultaneously the coverage engine, the cost optimizer, and (ordered **accuracy-first**) quality
control. For an AI coworker the "providers" are *tool tiers*: cheap search API → the company's
own site → identifier resolution → (future) a paid data provider. Stop the cascade the moment a
field is confidently, source-backed filled. Ref: Clay data waterfalls; Firecrawl search-API
comparison.

## How it wires into the DPF process spine

The capability plugs into four existing substrates — it invents no new plumbing.

**Gates.** One enrichment write already passes a full stack, and CI writes must ride the same
one:
`proactivity (activityFamily "crm-record-enrichment")` → `propose_crm_enrichment` files an
`MdmStewardTask(kind=enrichment, status=open)` **with no write** → human reviews the diff at
`/admin/data-stewardship` or the account page → `apply_crm_enrichment` (`sideEffect:true`,
capability `operate_customer`) enters `governedExecuteTool` → user-capability → agent-grant
(`crm_write`) → **coworker-authority** (allow / deny / **require-approval → approval envelope +
HITL tier**) → apply-with-provenance + timeline diff + resolve task → **audit row + execution
receipt**. HITL tier is `Agent.hitlTierDefault` (0=human-only, 1=approve, 2=review,
3=autonomous); team-level gating is `ValueStreamHitlGate` (`before-tool` / `phase-transition`).
*Design rule: every record-touching CI write is a `sideEffect:true` pack tool, never a direct
Prisma write — that is what routes it through this stack.*

**Lifecycles.** The coworker rides two at once: its **own** coworker lifecycle
(`establish_coworker` → certify (golden journey) → promote — a draft coworker is not summonable)
and the **subject's** lifecycles — the CRM engagement lifecycle
(`prospect → qualified → onboarding → active → at_risk → suspended → closed`,
`customer-lifecycle.ts`) and the `MdmStewardTask` lifecycle (`open → resolved_enriched`).
Enrichment/CI output should populate the account's **`research`** (and `review`) lifecycle review
queues (`account-estate-summary.ts` `reviewQueueCounts`) and strengthen `prospect → qualified`
signals. Generic `LifecycleEvent` / `LifecycleGap` (OVSM backbone) records the transitions.

**Work rooms (EP-WORKROOM-COMMS).** A room is the collaboration surface over a `WorkItem`
(`WorkItemMessage` / `WorkItemPresence`), not a separate table. A CI investigation should be a
**finite-mode `WorkItem` room** on the `explore` team's queue: the CI coworker is admitted as a
`contributor`/`specialist`, posts findings via `post_room_message`, invites the account owner as
`approver`/`reviewer` via `invite_room_participant`, emits a `decision-proposed` activity, and the
enrichment `apply` surfaces as a `governed-action` room activity with a `receipt` — the whole
investigation is one auditable room, not a side channel.

**Value streams (EP-VST-001).** CRM/customer work and `market-research-analyst` sit on the
**`explore`** value stream (discovery/qualification of `prospect` accounts). Wire the CI coworker
as a `ValueStreamTeamRole` (`workerType: ai-agent`, `modelTier`, `grantScope` incl.
`operate_customer` + the enrichment grants) on an `explore` `ValueStreamTeam` whose `WorkQueue`
receives CI `WorkItem`s and whose `ValueStreamHitlGate` composes with the per-tool authority gate.

## The skill — `skills/customer/crm-enrichment.skill.md`

A `.skill.md` playbook (frontmatter → `SkillDefinition` + `SkillAssignment` via
`seed-skills.ts`), `assignTo: ["customer-advisor", "market-research-analyst"]`,
`allowedTools: [search_public_web, fetch_public_website, propose_crm_enrichment,
apply_crm_enrichment, list_customer_accounts]`, `riskBand: medium`,
`enforces` the no-fabrication + evidence-before-diagnosis principles. It scripts the method:
gap detection → permission + scope confirm → **identity-resolution gate** → **accuracy-first
source waterfall** → **grounded-or-blank + per-field provenance** → **compliance tiering
(never scrape LinkedIn; gate personal-contact)** → `propose_crm_enrichment` (diff + gaps) →
human approves → `apply_crm_enrichment` → freshness note. This is the genuinely net-new artifact
and the home of "what others do."

## Tool hardening (optional, incremental — separate BI)

Fold the 4 market decisions the shipped tools don't yet *enforce* into
`apps/web/lib/crm/enrichment/`:
- **Identity-resolution gate** (decision ①) in `enrichment-proposal.ts`: require an `anchor`
  (domain or name+geo+corroborator) + per-finding `anchorAgreement`; drop findings that don't
  agree; return a `matchScore` and refuse to file below threshold. *Today the tool trusts
  coworker-supplied findings blindly — this is the biggest correctness gap.*
- **Confidence + passage fields** (decision ②) on `EnrichmentFinding`
  (`confidence`, `retrievedAt`, `supportingPassage`) and a check that categorical values are in a
  taxonomy enum.
- **Compliance risk-tier + suppression-list hook** (decision ③): tag each field
  `firmographic | personal-contact`; personal-contact requires a lawful-basis flag and a
  suppression-list miss before it may be proposed.
- **Per-field freshness** (`retrievedAt` → staleness SLA) driving re-enrichment triggers.

## Config turn-on checklist (separate BI)

1. Set `brave_search_api_key` (PlatformConfig) or `BRAVE_SEARCH_API_KEY`.
2. Confirm the CRM coworker's turns can enable external access (the web toggle) — and verify the
   `buildPhases:["ideate"]` metadata on the web tools does not hide them from CRM chat; widen the
   scope if it does.
3. Promote `market-research-analyst` from draft → production (certification sweep + `promote`),
   or decide to run the loop on the already-granted `customer-advisor`.
4. (Operator-owned, separate) Restore AI model routing (Azure OpenAI trust-evidence attestation).
5. Re-drive the live loop (`dpf-verify-on-live-install`) and record runtime verification.

## Compliance stance (non-negotiable)

Never scrape LinkedIn or any ToS-prohibited source directly. Firmographic data comes from the
company's own public site, business registries, and news. Personal-contact fields are gated
behind a documented lawful basis, a suppression-list check, and jurisdiction awareness, and are
never fabricated or materialized from masked/partial values. This is the platform's data-trust
promise made operational.

## Non-goals

- A new web-research MCP tool (the three public-web tools suffice).
- Paid third-party data providers (a future waterfall tier).
- Auto-committing any write without the propose→review→apply gate.
- Building a second CI coworker (BI-6D10EB1F already landed; this promotes/equips it).

## Rollout (BIs)

1. **This PR** — this spec + the `crm-enrichment` skill (`skills/customer/crm-enrichment.skill.md`).
2. **BI (config turn-on)** — the checklist above; re-drive live.
3. **BI (tool hardening)** — identity gate + confidence/passage tuples + compliance/suppression.
