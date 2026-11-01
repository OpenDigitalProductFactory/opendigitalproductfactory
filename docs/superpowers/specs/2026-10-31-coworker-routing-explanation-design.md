# Coworker routing failure explanations

Backlog: BI-3EA21FE6. Workroom: WC-A9C87759. Design authored 2026-10-31; status: proposed, implementation admission pending.

## Problem and evidence

The native COO returned a universal missing-clearance remedy for a mixed refusal: 13 residency exclusions, 8 streaming capability exclusions and 8 clearance exclusions. No endpoint was selected. This was observed on recovery.154 at dc1e4b5f66fae06c5c1cfcb8f82ec79b971e5cc7; route decision cmvx51ywq151801mesumzh4ps and baseline execution evidence cmvx559hq16rp01me8ooe824y. A successful provider connection test did not change that result. These facts do not establish that the local-only screening decision is wrong.

## Design grounding

Extend the existing [routing dead-end visibility plan](../plans/2026-08-16-routing-dead-end-visibility.md), whose contract already requires truthful count-based explanations. Reuse routing/pipeline-v2.ts, routing/NoEligibleEndpointsError in inference-error.ts, inference/routing-exclusion-buckets.ts and tak/inference-dead-ends.ts. The existing agentic loop passes the original error to describeToolRouteFailureOutcome. No new persistence or wire vocabulary is required.

OBJ-1: Explain known exclusion families without claiming one cause applies to every candidate.
OBJ-2: Preserve safe diagnostics, non-egress constraints and execution uncertainty.

## Contract and flow

R1: Mixed reasons must not append the legacy universal clearance clause. The specialized clearance explanation is valid only for a complete nonempty all-clearance set.
R2: At the coworker failure projection, prefer the validated existing content-free eligibility summary on the typed error. Render allowlisted bucket labels/counts and an existing destination. Unknown or absent information stays generic. Never project raw reason samples.
R3: A local-only residency value does not prove a screening block or a provider attempt. Preserve unknown/no-attempt versus explicit policy-block semantics from existing contracts. The explanation neither changes eligibility nor initiates recovery.
R4: Remove unsupported statements that the built-in model was evaluated and found inadequate. Do not promise clearing one constraint will make a mixed-failure request run.

F1: Existing inference failure -> execution-uncertainty handling -> validated routing eligibility explanation -> established fallback when evidence is absent. Existing successful routes/dispatch remain unchanged.

## Acceptance and verification

V1 (OBJ-1): Mixed exclusions do not produce a universal no-provider-clearance claim or imply reattestation will resolve other constraints.
V2 (OBJ-1): All-clearance fixtures may name clearance with truthful scope; do not invent evaluation or inadequacy of a local model.
V3 (OBJ-2): Unknown/empty diagnostics retain honest fallback and never expose payload values, prompt text, raw exceptions or account identifiers.
V4 (OBJ-2): No-attempt local-only evidence remains distinct from an explicitly supported screen block; no fabricated execution or blind retry.
V5 (OBJ-1, OBJ-2): Regression test enters the actual coworker failure projection; successful routing/dispatch behavior remains unchanged.

Use mixed 13/8/8, all-clearance, clearance-plus-quality, unknown reason, local-only/no attempt, explicit governed block, empty diagnostics and successful-route controls. Assert through the actual failure projection, including a malicious raw reason that must never render. Source tests and package typecheck precede canonical integration and deployed verification; no pass is claimed here.

## Alternatives and boundaries

Keeping the universal string preserves the reproduced wrong remedy. Inventing another diagnostics model duplicates the canonical safe summary. Reusing the existing typed error and summary is the smallest repair. No routes, schema, account terms, grants, clearance, local pause, provider selection, screening, capacity or dispatch policy changes. No Inspector or response feedback control edits; coordinate any scope expansion with its owner first.

## Compatibility, risk and rollback

Legacy errors without validated eligibility retain a truthful generic fallback. Do not change uncertain execution classification. Existing diagnostic consumers must keep their safe DTO boundary. Roll back the explanation code through a protected PR; retain operational evidence and never replay a task as rollback. No migration is needed.

## Dependencies

Prior done peer-owned BI-431524DF and BI-E2CCFAC1 remain historical references. PR6782 assignment search does not cover this defect. Routing owner acknowledged no active local overlapping writer. The first release batch is unchanged. Original paired-installation streamlining-spec lookup is separate, currently blocked by peer upgrade/sign-in. Funding binding and native implementation admission remain pending.


