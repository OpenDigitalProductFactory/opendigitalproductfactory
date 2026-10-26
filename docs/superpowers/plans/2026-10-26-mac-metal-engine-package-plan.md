---
status: active
backlog_item: BI-86B65F35
workroom: WC-06E454C7
---
# Mac Metal engine package implementation plan

## Scope and stop condition
Implement BI-86B65F35 against the companion ordered fix design.
A built artifact, a qualified package and an activated engine are separate outcomes.
Stop before an unavailable authority/runtime-coordination boundary; report missing evidence as unrun.
The original BI-285EF102 reviews remain immutable and are not prerequisites replaced by this work.

## Acceptance quoted from the live item
- AC-MAC1: Build the corrected engine from an immutable upstream commit with verified source and patch identities; explicitly select Metal4 only for the tensor-capable compilation path and preserve the existing fallback.
- AC-MAC2: Produce a versioned Apple Silicon package with a verified file manifest, source/patch/toolchain/SDK/build provenance, licenses and an isolated staging path; never claim Docker’s vendor digest for changed bytes.
- AC-MAC3: Reproduce the SDK-default failure and demonstrate corrected tensor self-test compilation and pipeline creation on this M5 Max; exercise fallback controls and report physical older-Mac coverage as unrun where unavailable.
- AC-MAC4: Qualify the candidate with the existing model’s chat/tool/cache behavior and matched cold/warm measurements under governed runtime coordination before recommending activation; preserve unknown, failed and truncated outcomes.
- AC-MAC5: Record actual package and qualification evidence plus rollback/integration constraints in shared AI Ops learning; distinguish a built candidate, a qualified package and an activated live engine.

## Phase 1: provenance and regression controls
Internal sequencing; not independently shippable.
Files: tools/mac-inference/engine.lock.json, metal-language.patch, metal-language-probe.m and engine-package.test.mjs.
Pin upstream72874f559c598b8f89fbb24864868337cf5afb4c and verified source/patch identities.
Exercise malformed locks/manifests, path traversal, untracked payloads, corrupted files, unsafe library symlinks and the tensor/fallback selection.
Begin with failing behavior tests before implementation. A source fixture does not count as a runtime pass.

## Phase 2: package builder and verifier
Internal sequencing; not independently shippable.
Files: tools/mac-inference/build-engine.mjs and verify-package.mjs with shared package helpers if needed.
Use built-in Node APIs, existing Xcode tooling and an explicitly selected CMake.
Build only in an isolated candidate workspace; copy the actual library closure, license and provenance.
Reject an occupied destination and unsupported host/architecture before source changes.
Run Node tests and native build; verify all output files and relocation behavior.

## Phase 3: qualification and operating contract
Internal sequencing; not independently shippable.
Files: tools/mac-inference/qualify-engine.mjs and docs/operations/mac-inference-engine.md.
Run the f16 tensor test and fallback controls on this M5 Max.
Use the existing single GPU coordination contract before candidate inference; never treat a local process or idle snapshot as a lease.
Use the existing model digest and matched completion controls. Save metadata, correctness verdicts and timing; exclude prompts/raw reasoning.
Record package SHA256 and exact configuration. Do not claim a speedup before matched results exist.

## Phase 4: protected delivery and learning
The assembled change is the one independently reviewable delivery.
Run the affected tests, documentation checks and exact-tree publication gates.
Use DCO and protected PR/merge queue. No hand-built image or direct live engine replacement.
Link actual qualification to DOC-B39A42F1 and BI-IMP-AE7792A0/IP-89CEE.
Record physical older-Mac coverage as unrun; record a blocked inference qualification as unrun.

## Backlog coverage
Atomic deliverable: BI-86B65F35.
The source patch, provenance builder, verifier, qualification controls and operating contract are one package contract; none is independently safe to ship.
Coverage receipt pending the immutable plan commit. This text does not assert a receipt.
Requirement references: AC-MAC1, AC-MAC2, AC-MAC3, AC-MAC4, AC-MAC5.
Contract references: CONTRACT-MAC-ARTIFACT, CONTRACT-MAC-RUNTIME.
Flow reference: FLOW-MAC-CANDIDATE.
Verification reference: VERIFY-MAC-PACKAGE.

## Impact obligations
WC-06E454C7's initial contract has no UI routes, migrations or guard obligations for the two documentation paths.
Refresh explicit code-path claims before implementation; consume their returned testImpact/guardObligations.
The registered documentation index must be regenerated/checked for changed published corpus inputs.
The checkout is source-only: no pnpm, Vitest or Prisma check is claimed. Built-in Node tests and standalone native diagnostics do not depend on those missing artifacts.

## Rollback
Before activation, stop the candidate and keep its isolated files unqualified; Docker remains untouched.
Revert the one source change through the protected PR process. Never erase historical qualification evidence.
