# Authorized Response Rehydration Implementation Plan

> Execute this plan in `WC-2F922A0B` with test-first behavior changes. Keep
> plaintext confined to the bounded vault and the final authorized return value.
> A missing or ambiguous fact preserves the tokenized response.

**Status:** Approved backlog work; implementation in progress.

**Backlog item:** `BI-6A8B3910`

**Work Capsule:** `WC-07BB587B`

**Branch / worktree:** `feat/response-rehydration-authz` /
`D:\DPF-worktrees\response-rehydration-authz`

**Plan backlog coverage:** atomic receipt `cms398qau038001qjk2t1cr3y`

**Architecture decision:** `DI-CCC427A3EF51` selected a dedicated
response-rehydration PEP over inline masking-module authorization or
surface-owned rehydration. WWMD returned high confidence, a 9.706 composite
score, a 3.826 margin, and no commandment conflict.

## Outcome

DPF can restore tokenized model-output values only through one reusable,
fail-closed response gateway. The gateway combines immutable dispatch-time
binding with the current `EffectiveAuthContext`, validates purpose and surface,
checks employee/customer/partner relationships and explicit sensitivity
clearance, and re-reads policy versions immediately before disclosure. Denied
tokens remain tokens; raw values never enter evidence, logs, memory, shared
surfaces, or exception text.

This plan implements only response disclosure. New human-approval and nested
agent call-chain semantics remain owned by `BI-62BFAA95`.

## Backlog coverage

- Decision: atomic
- Parent: `BI-6A8B3910`
- Receipt: `cms398qau038001qjk2t1cr3y`
- Dependencies: completed `BI-DG-009`, `BI-DG-012`, and `BI-749EB750`, plus
  the merged classifier and routing-binding slices of `BI-3D210AF8`
- Dependency order: bound token vault -> response PEP -> routing binding ->
  conformance and documentation.
- Rationale: a vault lookup without the PEP exposes plaintext, a PEP without
  immutable dispatch-time binding trusts rehydration-time caller assertions,
  and route propagation without both creates an unsafe or unusable handle.
  The four phases form one security boundary and are not independently
  shippable.

| Deliverable | Dependency | Independently shippable |
|---|---|---:|
| Bound token vault | None | No |
| Response-rehydration PEP | Bound token vault | No |
| Routing binding and handle propagation | Vault and PEP | No |
| Conformance tests and documentation | All behavior phases | No |

## Effort budget

Use 20% of implementation effort for bounded refactoring:

- Extract token generation, expiry, capacity eviction, and lookup from
  `mask-for-context.ts` into one data-governance vault module.
- Keep the authorization evaluator pure and inject the clock/version reader so
  TOCTOU and expiry behavior are deterministic.
- Propagate one optional rehydration descriptor instead of adding
  surface-specific lookup helpers.

The remaining 80% implements and verifies the response security boundary.

## Phase 1: Define the authorization contract test-first

**Files**

- Create: `apps/web/lib/govern/data/response-rehydration.ts`
- Create: `apps/web/lib/govern/data/response-rehydration.test.ts`

**Behavior**

- Define closed private and shared/public response-surface values.
- Define explicit employee, account, contact, partner-account, and principal
  subject references; do not infer subjects from response text or route names.
- Require a closed processing purpose, an expected viewer principal, acting
  human/agent identity when applicable, minimum sensitivity, and privacy-safe
  policy decision versions.
- Permit employee disclosure only through the canonical employee capability
  plus self/direct/indirect manager scope.
- Permit customer and partner disclosure only through canonical account scope.
- Require exact explicit sensitivity clearance; superuser status does not
  silently override clearance.
- Reject shared/public surfaces, unknown values, identity mismatch, missing
  delegation evidence for an acting agent, and any policy-version drift.

## Phase 2: Extract and bind the token vault

**Files**

- Create: `apps/web/lib/govern/data/rehydration-token-vault.ts`
- Create: `apps/web/lib/govern/data/rehydration-token-vault.test.ts`
- Modify: `apps/web/lib/govern/data/mask-for-context.ts`
- Modify: `apps/web/lib/govern/data/mask-for-context.test.ts`

**Behavior**

- Move the keyed stable-token primitive and bounded five-minute vault behind a
  narrow module.
- Store each token map with an immutable response-authorization binding.
- Preserve existing opaque handle format and masking behavior.
- Keep unbound legacy handles non-rehydratable rather than widening them.
- Return only generic missing/expired/unauthorized outcomes; errors and
  evidence must not include handles, tokens, or raw values.

## Phase 3: Add the response PEP and routing binding

**Files**

- Modify: `apps/web/lib/inference/routed-inference-options.ts`
- Modify: `apps/web/lib/inference/data-screening/routed-screening.ts`
- Modify: `apps/web/lib/inference/routed-inference.ts`
- Modify affected routed-inference and screening tests

**Behavior**

- Accept an optional server-owned response-authorization binding with the
  route request and attach it to tokenization.
- Preserve the opaque handle through the routed result without exposing the
  token map.
- Rehydrate string and structured response values token-by-token only after a
  fresh PEP allow.
- Preserve denied and malformed tokens unchanged, including mixed allow/deny
  output.
- Ensure AI-coworker acting identity can only narrow the authenticated human's
  authority.

## Phase 4: Conformance, architecture, and verification

**Files**

- Modify:
  `docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md`
- Modify: `apps/web/lib/ea/ai-routing-architecture-registry.ts`
- Modify related architecture extraction tests

**Behavior and evidence**

- Mark the rehydration gateway and masked/authorized response branches as
  implemented only after their source anchors exist.
- Test manager allow, peer deny, unrelated manager deny, shared-surface deny,
  account mismatch, insufficient clearance, expired handle, missing binding,
  malformed/repeated tokens, acting-agent mismatch, and TOCTOU drift.
- Add plaintext canaries for logs, receipts, memory, and returned denied output.
- Run affected Vitest suites, web typecheck, exact-head merged-code local
  integration, production build, PR health, and merge-group verification.

## Risks and rollback

- **Caller fabrication:** response-time callers cannot supply or replace the
  stored subject, purpose, surface, actor, or version binding.
- **Handle theft:** an opaque handle is useless to another principal or surface.
- **Privilege widening:** missing clearance, relationship, delegation, version,
  or surface evidence returns the tokenized response.
- **Partial disclosure:** authorization is evaluated per stored token binding;
  one allowed token cannot unlock a denied sibling.
- **Rollback:** the change is in-memory and additive. Removing the gateway
  leaves tokenized responses intact and stores no schema or migration state.
