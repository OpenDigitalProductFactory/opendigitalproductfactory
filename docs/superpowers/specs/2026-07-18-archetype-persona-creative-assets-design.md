# Archetype Persona Creative Assets Design

| Field | Value |
| - | - |
| Date | 2026-07-18 |
| Status | Reviewed - approved 2026-07-18 |
| Author | Codex + Mark Bodman |
| Scope | Define the narrative, still-image, graphic, and short-video creative system for owner-facing DPF archetype/persona marketing, anchored in the live portal coworker UX and mapped back to archetype test priorities |

## 1. Purpose

DPF now has a source-grounded archetype catalog, an owner-positioning matrix, and three named persona anchors: Dale HVAC, Linda dental clinic, and Marisol retail. The next marketing step is to turn those into customer-facing creative assets: narratives, images, graphics, and short videos showing an AI coworker helping the owner stay on top of the work around the work.

The first deliverable is not a generated-image batch. The first deliverable is a reusable narrative system that makes every visual prompt and storyboard specific, credible, and testable.

## 2. User Direction

The approved creative pattern is:

1. Use a **day-in-the-life** narrative as the backbone.
2. Include a **before/after** block for sales clarity.
3. Include a **coworker-in-action** beat list for product-demo clarity.
4. Anchor the AI coworker depiction in the real DPF live portal UX, especially the `/workspace` "Living business", "What needs you now", owner attention, operational twin, and coworker/decision-card patterns.
5. Start with Dale, Linda, and Marisol, then expand across the remaining archetype categories.

## 3. Current-State Grounding

Verified local context:

- `http://localhost:3000/workspace` responds on the live portal.
- The source UX anchors are:
  - `apps/web/components/workspace-home/WorkspaceTwinHero.tsx`
  - `apps/web/components/workspace-home/WorkspaceTwinPanel.tsx`
  - `apps/web/components/workspace-home/OperatorCockpit.tsx`
  - `apps/web/components/attention/OwnerDecisionCards.tsx`
  - `apps/web/components/attention/OwnerAttentionStatus.tsx`
- The visual grammar to preserve:
  - "Living business" identity line
  - the archetype or business name as the primary workspace identity
  - a single "What needs you now" owner-attention surface
  - AI coworker actions shown as proposals, drafts, reminders, routed tasks, or decisions awaiting owner judgment
  - operational twin / owner cockpit context below the attention rail
- Allowed UI anchors for visual prompts and `UX substitution note` fields:
  - `WorkspaceTwinHero` for the "Living business" identity, archetype name, and operating question.
  - `OperatorCockpit` for the single "What needs you now" attention surface.
  - `OwnerDecisionCards` for decisions requiring owner approval, editing, reassignment, or rejection.
  - `OwnerAttentionStatus` for counts and "digital team handling" proof.
  - `WorkspaceTwinPanel` for the operational twin / owner cockpit body below attention.
- Every `UX substitution note` must name at least one allowed UI anchor and the exact archetype-specific replacement data, for example: `OperatorCockpit` + `OwnerDecisionCards`: replace generic decisions with missing forms, failed reminders, no-show risk, and practitioner overload.
- The owner-positioning source is `docs/architecture/archetype-owner-positioning.md`.
- The narrative persona anchors are:
  - `docs/personas/dale-hvac.md`
  - `docs/personas/linda-clinic.md`
  - `docs/personas/marisol-retail.md`

## 4. Deliverable Shape

Create a durable marketing narrative artifact at `docs/marketing/archetype-persona-creative-narratives.md`.

Each persona/category card must include:

1. **Owner moment:** one paragraph showing the owner doing the core job.
2. **Necessary-evil jobs:** the surrounding work DPF helps carry.
3. **DPF coworker help:** what the AI coworker prepares, drafts, tracks, or routes.
4. **Current-state claim:** what can be safely said from today's seeded archetype, workspace, and coworker substrate.
5. **Planned-state claim:** what belongs in future-state positioning until the audit or implementation verifies it.
6. **Before/after block:** concise marketing copy for decks or landing pages, bounded by the current/planned claims.
7. **Short-video narrative:** 30-45 seconds, with 4-6 beats.
8. **Still-image prompt:** a generation-ready prompt for one hero image or graphic.
9. **Storyboard frame prompts:** 3-5 frame prompts for later video/image generation.
10. **UX substitution note:** one or more allowed live-portal anchors plus the exact archetype-specific activity that replaces generic demo data.
11. **Test emphasis:** the product behavior that must be verified before the claim is safe in customer-facing material.
12. **Source/proof references:** at least one source document row/persona and one audit/proof target.
13. **Permission / synthetic-story note:** whether this is a synthetic persona/category story or a customer-approved case study.

## 5. Coverage Strategy

### 5.1 Pilot Narratives

Write first-class, higher-fidelity cards for:

- Dale, owner at a 4-truck HVAC repair shop
- Linda, scheduler at a neighborhood dental practice
- Marisol, merchandiser at a two-location specialty retail shop

These cards should be specific enough to become immediate image-generation prompts.

### 5.2 Category Expansion

Then write category-level cards for every source category in `docs/architecture/archetype-owner-positioning.md`, including the categories represented by the pilot personas. The expected first artifact count is **3 high-fidelity pilot persona cards + 21 source-category cards + 1 required MSP spotlight card**. The MSP spotlight is **not** a 22nd source category; it is a required leaf spotlight because `it-managed-services` has a materially different owner story even though it remains a `professional-services` archetype in the seed category model.

- Trades and maintenance
- Beauty and personal care
- Healthcare and wellness
- Pet services
- Food and hospitality
- Retail and goods
- Fitness and recreation
- Education and training
- Professional services
- IT managed services spotlight (required non-category spotlight for the `professional-services` MSP sentinel)
- Nonprofit and community
- HOA and property management
- Software platform
- Banking and financial services
- Public sector and civic
- Automotive services
- Moving and logistics
- Security services
- Real estate and construction
- Media production
- Live events and venues
- Rental and shared assets

The category cards for Trades and maintenance, Healthcare and wellness, and Retail and goods may reference Dale, Linda, and Marisol as examples, but they must still describe the broader category. The IT managed services spotlight may be rendered as a sibling card in the narrative artifact for readability, but it must be labelled as a spotlight and must not change the canonical **95 archetypes / 21 categories** inventory. Do not duplicate the full archetype-audit matrix. The marketing artifact should stay readable as a creative brief.

## 6. Visual Direction

Use realistic owner-operator scenes with the DPF interface present as a practical work surface. Avoid generic AI imagery, abstract glowing brains, robot characters, and fantasy dashboards.

The AI coworker should appear as one of:

- a clean DPF side panel or decision card in the real workspace UX
- a subtle assistant thread preparing drafts, reminders, and next actions
- a highlighted "What needs you now" queue with owner-approval actions
- a calm overlay in the operational twin showing what the coworker is watching

The human owner remains the hero. The AI coworker is the helper that makes the owner look more in control.

## 7. Short-Video Pattern

Use a repeatable 30-45 second structure:

1. **Opening pressure:** owner is doing the core work while admin pressure builds.
2. **Coworker scan:** DPF shows the "What needs you now" rail and the coworker-prepared list.
3. **Specific help:** one or two archetype-specific tasks are already drafted, routed, or flagged.
4. **Owner judgment:** owner approves, edits, or decides the sensitive item.
5. **Relief payoff:** owner returns to customers, crew, patients, members, residents, guests, or clients.
6. **Proof line:** close on the archetype-specific promise and the DPF workspace.

This pattern works for still-image sequences, animated explainer boards, or later AI-generated video.

## 8. Guardrails

- Current-state and planned-state claims must stay separate.
- Do not imply DPF performs regulated professional judgment, clinical advice, legal advice, core banking activity, CJI access, full ticketing, payment rails, payroll, or accounting ledger replacement.
- Do not depict the AI coworker publishing externally without approval.
- Do not show private patient, financial, legal, or public-safety details in generated images.
- Do not use real customer names or unapproved case-study claims.
- Do not make the UI look like a separate product if it is meant to represent DPF; use the live portal's workspace/coworker visual grammar.

## 9. Testing Linkage

Every narrative card must end with a test emphasis. The test emphasis should map to `docs/testing/archetype-audit-plan.md` and `docs/architecture/archetype-owner-positioning.md`.

The rule is simple: if marketing says the coworker helps the owner stay on top of a burden, the audit must be able to verify the field, state, card, coworker response, refusal, or approval path that proves it.

## 10. Verification

For the documentation slice:

- Run `pnpm docs:index`.
- Run `git diff --check`.
- Run `pnpm docs:index:check`.
- Run `pnpm docs:links`.
- Run `pnpm check:doc-links`.

No production build or browser UX gate is required for the narrative artifact unless the work changes application code or committed visual assets used by the portal.
