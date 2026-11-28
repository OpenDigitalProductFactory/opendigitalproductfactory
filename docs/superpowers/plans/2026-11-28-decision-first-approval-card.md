---
status: active
---

# Decision-first approval card with registry-driven tool descriptors — BI-CF03AA73

- **Backlog:** `BI-CF03AA73`
- **Workroom:** `WC-2DB31DA0` (`delivery-medium@1.0.0`, admitted `IRD-8B99A3A5E4A5`)
- **Decision record:** `DI-CC33A7978BBB` (`registry-driven-decision-first`)
- **Design:** [`2026-09-01-approval-cards-recommendation-versus-authorization-design.md`](../specs/2026-09-01-approval-cards-recommendation-versus-authorization-design.md#registry-driven-decision-first-approval-card--bi-cf03aa73-2026-11-28)
- **Prototype:** [`2026-11-28-decision-first-approval-card-prototype.html`](../specs/2026-11-28-decision-first-approval-card-prototype.html)

## Acceptance baseline (quoted from BI-CF03AA73)

- AC-1: `RegisteredToolDefinition` supports an optional typed `approvalPresentation` descriptor (plain-language title, what-it-does summary, impact/reversibility note, and human-labeled parameter projection) used by `coworker-envelope-decision.ts` without changing authorization bindings or execution endpoints.
- AC-2: `run_discovery_triage` (and other descriptor-equipped tools) renders a specific plain-language headline, concrete What / Why now / Impact rows, and an accurate internal/reversible posture instead of "Review this coworker request?" / "Reversibility is not established." / "Keep this on hold".
- AC-3: Genuinely unknown/unregistered tools, malformed parameter shapes, and unverified consequential operations fail closed: they remain visibly unverified, recommend holding, and surface all material facts (payments, recipients, permissions, destinations, deadlines, empty/false values) outside disclosure.
- AC-4: The primary card surfaces the actual gate/coworker reason (`Why now`, from `envelope.rationale` / descriptor context, sanitized of raw internal IDs) and removes the static boilerplate "Why am I being asked?" disclosure.
- AC-5: Expanding the single technical/details drawer shows non-empty human-labeled parameters, expiry/scope, compact audit identifiers, and exact raw JSON without duplicating the legacy card or rendering "Not named in the proposal" / "Not attached" filler rows.
- AC-6: All UI changes reuse DPF theme tokens and report-kit primitives, pass unit/typecheck/style/UX-fit gates (including a committed `docs/ux-fit/*.ux-fit.json` manifest backed by the recorded `principle_decide` interaction), and preserve keyboard accessibility, mobile layout, on-behalf decisions, standing rulings, and pending/unknown reconciliation.

## Ordered implementation tasks

1. **Leaf descriptor contract (`apps/web/lib/tool-approval-presentation.ts`, `apps/web/lib/mcp-tool-types.ts`):**
   - Define `ApprovalReversibility`, `ToolApprovalParamLabel`, and `ToolApprovalPresentation` in a dependency-free leaf module so `mcp-tool-types.ts` stays acyclic.
   - Add pure helpers to validate exact `allowedParams` (and optional `allowEmptyParams`), check descriptor-vs-`consequence` consistency, and format human-labeled parameter values.
   - Attach optional `approvalPresentation?: ToolApprovalPresentation` to `ToolDefinition`.
2. **Co-located tool descriptors (`apps/web/lib/mcp/packs/discovery-inventory-pack.ts`):**
   - Declare verified `approvalPresentation` metadata for `run_discovery_triage`, `discovery_sweep`, `run_hive_scout_ingest`, `attribute_entity_to_product`, `dismiss_entity`, `resolve_portfolio_quality_issue`, `enrich_digital_product`, and `request_re_enrichment`.
   - Add `apps/web/lib/tool-approval-presentation.test.ts` verifying every tool in `PLATFORM_TOOLS` that declares `approvalPresentation` never contradicts its declared `consequence` and only references keys present in its `inputSchema`.
3. **Envelope source & primary decision projection (`apps/web/lib/attention/sources/coworker-envelope.ts`, `apps/web/lib/attention/coworker-envelope-decision.ts`, `packages/i18n/src/messages/en-US/approvals.json`):**
   - Load both `consequence` and `approvalPresentation` from `PLATFORM_TOOLS` in `coworker-envelope.ts`.
   - Project descriptor-backed tools cleanly into `envelopePrimaryDecision` with `title`, `description` (What), `why` (sanitized Why now), `consequence` (Impact), `posture` (`reversible` | `bounded` | `outward` | `authority` | `irreversible` | `unverified`), `declineDoes`, and human-labeled drawer parameters.
   - Strictly fail closed when a proposal has unexpected arguments, missing required arguments, or an unrecognized tool — preserving material facts and the hold recommendation.
4. **Decision-first card & single clean drawer (`apps/web/lib/ui-model/statusColors.ts`, `apps/web/components/attention/CoworkerEnvelopeApproval.tsx`, `apps/web/components/attention/OwnerDecisionCards.tsx`):**
   - Add `approvalPosture` domain to `STATUS_INTENT`.
   - Render posture `StatusBadge` (`variant="soft"`, `textTone="body"`) beside deadline tags in `OwnerDecisionCards.tsx`.
   - Render scannable `What` / `Why now` / `Impact` rows in `CoworkerEnvelopeApproval.tsx`, remove static `"Why am I being asked?"`, and replace the three stacked technical blocks (`HUMAN AUTHORIZATION NEEDED` card + nested `Technical details` + duplicate `OwnerDecisionCards` `TechnicalDetail` `"Not attached"` dump) with one flat `Technical evidence` drawer containing human-labeled non-empty parameters, compact audit reference, and collapsed `Complete proposed content` `<pre tabIndex={0}>`.
5. **Verification & governance gates:**
   - Update and expand unit/component tests (`tool-approval-presentation.test.ts`, `coworker-envelope-decision.test.ts`, `coworker-envelope.test.ts`, `CoworkerEnvelopeApproval.test.tsx`, `CoworkerEnvelopeApproval.on-behalf.test.tsx`, `statusColors.test.ts`) and add a `discovery-triage` scenario to `apps/web/scripts/approval-disclosure-verification.ts`.
   - Commit `docs/ux-fit/2026-11-28-decision-first-approval-card.ux-fit.json` referencing `DI-CC33A7978BBB`.
   - Run targeted vitest suites, `pnpm --filter web typecheck:all`, `pnpm --filter @dpf/i18n typecheck` (if applicable), style/UX-fit/import-cycle/doc-index guards, and `pnpm gate:context`.
   - Record live plan backlog coverage (`record_plan_backlog_coverage`), commit DCO-signed, and land via `pnpm land`.

## Atomic backlog coverage

Single deliverable mapped to `BI-CF03AA73` (no child items or dependencies). Coverage receipt will be recorded against the committed plan blob via `record_plan_backlog_coverage`. No database migration, new API endpoint, or permission model change is introduced.
