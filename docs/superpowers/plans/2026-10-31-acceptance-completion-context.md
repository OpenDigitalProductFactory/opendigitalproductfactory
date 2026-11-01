# Acceptance completion context implementation
Backlog: BI-5B0CD1BC. Design: [acceptance completion context](../specs/2026-10-31-acceptance-completion-context.md).
Workroom: WC-6D95C3A1. Decision: DI-A96BC6850DB1.

## Body acceptance criteria (verbatim)
- Regression reproduces actual offered packet to request admission failure before repair.
- Exact eligible packet issued from typed completion is accepted by canonical request admission against unchanged current facts.
- Read and bounded recovery expose the same current prerequisite/result as issuance and admission.
- Changed or revoked evidence, baseline, source, room admission, independence and authority refuse stale requests.
- Missing or malformed completion context remains truthful missing/unavailable, never historical allow.
- Affected tests, typecheck and applicable governed verification pass; source and live verification remain separate.

## Atomic delivery and traceability
One independently shippable correction: BI-5B0CD1BC. Persistence without current evaluation, or evaluation without authorized input provenance, cannot safely repair packet admission. Phases below are internal sequencing, not separate releases.
Requirement reference: acceptance-context-consistency.
Contract reference: current-completion-input-binding.
Flow reference: typed-completion-to-read-to-request-admission.
Verification reference: acceptance-packet-roundtrip-regression.

## Steps
1. Claim exact implementation paths after inspecting existing tests and current impact contract. Preserve existing claims, source identity and independent ownership. Establish current research receipt and plan coverage before implementation.
2. Write a failing regression using actual completion evaluation, terminal recovery and request-admission boundaries, with in-memory persistence and mocked provider/authority reads only. Capture RED. Include an archived medium body-author shape and explicit completion manifest, not a mocked always-successful route.
3. Extend the existing terminal audit payload with normalized input context and source/scope binding. Share context resolution in the canonical evaluator. Re-evaluate current evidence rather than replaying a verdict. Add negative cases for malformed/latest-invalid context, changed evidence, baseline, scope/source and revoked eligibility. Keep existing packet equality and original-task protection.
4. Refactor shared context code and fixtures as needed (20% relevant refactoring target). No alternate orchestration. Run affected evaluator, terminal repository, body routing, MCP read and independent request tests; run web typecheck. Reconcile the claimed-path testImpact/guardObligation contract; unresolved advice requires broader checks.
5. Update user-facing recovery documentation in the same PR if behavior changes. Regenerate/check docs index and applicable data-impact artifacts for additive persisted JSON context; no schema migration.
6. Commit with DCO, get independent source review, run canonical local integration and ready-PR checks. Push and open a ready PR only when applicable checks are green; preserve unavailable native review as UNKNOWN. Protected merge queue remains mandatory.
7. After canonical containing deployment, retry the existing BI-1A4CC847 typed completion and exact packet once on changed state. Record observed outcome separately; no replay of historical UNKNOWN tasks and no fabricated acceptance.

## Expected source boundary
Existing backlog-completion-evaluation.ts, backlog-terminal-transition.ts, terminal-transition-repository.ts and one shared context helper if existing modules cannot host it coherently. Boundary regression under lib/mcp and focused readiness tests. Modify read/independent request adapters only if shared evaluator integration proves insufficient. Exact path claims precede edits.

## Verification and impact
Design-path impact resolved to docs index generation/check; implementation impact must be read from the next exact scope claim. Tests run from D:/DPF-worktrees/acceptance-context-admission/apps/web with runner root verified. Worktree source tests do not establish live acceptance. Canonical build gate, PR health and deployment lineage remain distinct.

## Risks and rollback
Stale context falsely authorizing current work is the primary risk. Current baseline/source/scope binding, newest-attempt selection, evidence revalidation and unchanged authority checks fail closed. Legacy absent context stays missing; a fresh authorized completion submission repairs it. One PR rollback removes reuse without making old decisions authoritative.

## Backlog coverage
Coverage receipt cmvx3yce60xch01mex4kzsmg2 binds plan blob 729f048b584c2aba6169b0b102cda86e3142889d at f88f584c7c79f3b6348e1bffbe3844c1bc867728. Parent and sole deliverable: BI-5B0CD1BC; decision atomic for the inseparable persistence/evaluation/admission contract. Implementation admission IRD-048D522F8A3E allowed the medium, low-risk scope on 2026-11-01. This receipt update does not change that scope or sequencing.
