# Design Grounding Gate — require spec and code-substrate evidence before UX/workflow changes

**Backlog item:** BI-11900EE7  
**Status:** Implementation plan for this PR  
**Scope:** External-agent process spine, UX/workflow/queue/navigation guardrails

## Problem

The Spec/Plan/Doc Gate proves that a substantial implementation PR touched a durable artifact or carried a `Process-Spine-Decision:` attestation. It does **not** prove the agent reviewed the existing specs/plans and current code substrate before making the change.

The Founder Review actionability incident exposed the seam. The final implementation aligned with the platform direction, but the process should have explicitly started from:

- `docs/superpowers/specs/2026-06-23-human-attention-surface-design.md`
- `docs/superpowers/specs/2026-05-26-build-studio-decision-skill-packs-design.md`
- `docs/superpowers/plans/2026-05-26-build-studio-decision-skill-packs.md`
- `docs/superpowers/specs/2026-07-04-decision-governance-surface-redesign-design.md`
- current code substrate such as `apps/web/lib/attention/aggregate.ts`, `apps/web/lib/attention/sources/ai-decision.ts`, and `apps/web/lib/founder-review/queue.ts`

The platform already has the right process pieces — `dpf-retrieve-decision-context`, `dpf-writing-plans`, `dpf-architecture-review`, `dpf-ux-fit-review`, `portal-navigation-audit`, the Spec/Plan/Doc Gate, and the UX-Fit Gate. The missing piece is an enforced handrail that asks: **what existing design and code did you ground against?**

## Design grounding evidence contract

For a non-trivial UX, workflow, queue, navigation, attention, or process-spine change, the PR must carry design-grounding evidence in either the PR body, a commit message, or a durable doc touched by the PR.

Minimum evidence:

- Existing specs/plans reviewed.
- Current code substrate reviewed, using the code graph and/or `rg`.
- Source of truth named.
- Decision recorded: extend existing spec/plan, update existing spec/plan, create a new artifact, or attest that no durable artifact changed because the diff is trivial.

Recommended PR body section:

```md
## Design grounding

- Existing specs/plans reviewed:
  - ...
- Current code substrate reviewed:
  - ...
- Source of truth:
  - ...
- Decision:
  - ...
```

One-line attestation form for truly trivial changes:

```text
Design-Grounding-Decision: reviewed <specs/code>; localized copy-only fix, no contract or routing change.
```

## Substrate reviewed

- Existing hard gate: `scripts/check-spec-plan-doc.mjs`.
- Existing UI hard gate: `scripts/check-ux-fit-decision.mjs`.
- Existing plugin pre-edit nudges:
  - `packages/dpf-skill-pack/hooks/spec-plan-doc-precheck.mjs`
  - `packages/dpf-skill-pack/hooks/ux-fit-precheck.mjs`
- Plugin hook manifest: `packages/dpf-skill-pack/hooks/hooks.json`.
- CI wiring: `.github/workflows/ci.yml`.
- Process-spine design precedent: `docs/superpowers/specs/2026-05-30-development-process-spine-design.md`.

No new database model, MCP tool, enum, or queue substrate is needed. This is a process-spine guard that composes with existing gates.

## Implementation phases

### Phase 1 — CI-visible design grounding gate

Add `scripts/check-design-grounding-decision.mjs`.

The gate should:

- Diff against the PR base.
- Detect UX/workflow/queue/navigation/process-spine-sensitive files.
- Ignore tests, generated files, and docs-only changes.
- Pass when no design-sensitive implementation files changed.
- Pass when evidence text contains a design-grounding marker plus both spec/plan evidence and code-substrate evidence.
- Fail with a clear message that tells the agent exactly what section to add.

Verification:

- `node --test scripts/check-design-grounding-decision.test.mjs`
- CI job runs the gate with `BASE_SHA` and `PR_BODY`.

### Phase 2 — pre-edit nudge for new threads

Add `packages/dpf-skill-pack/hooks/design-grounding-precheck.mjs` and wire it into `hooks.json` under the existing `Write|Edit|MultiEdit` matcher.

The hook should:

- Warn when a session edits UX/workflow/queue/navigation/process-spine-sensitive files.
- Stay non-blocking and fail open.
- Tell the agent to search specs/plans and the code graph before implementation.

Verification:

- `node --test packages/dpf-skill-pack/hooks/design-grounding-precheck.test.mjs`
- Existing plugin hook wiring test proves the hook ships.

### Phase 3 — canonical process wording

Update `AGENTS.md` to state the design-grounding rule in the rulebook, so fresh threads see it before relying on hook output.

Verification:

- Spec/Plan/Doc Gate sees the durable process artifact.
- Doc reference integrity remains green.

## Rollback

If the gate produces too much noise, remove the CI job first while keeping the non-blocking pre-edit nudge and AGENTS.md wording. The hook alone still improves steering without blocking merges. If the hook proves noisy, narrow its path patterns rather than deleting the evidence contract.

## Acceptance criteria

- Design-sensitive PRs must prove which existing specs/plans and code substrate were reviewed.
- New threads get an early local nudge before implementation.
- The rule is visible in AGENTS.md, not just CI output.
- Tests cover pass/fail cases for both the CI gate and the pre-edit hook.
