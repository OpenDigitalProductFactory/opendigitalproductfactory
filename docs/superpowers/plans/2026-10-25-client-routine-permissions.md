---
status: active
---

# Routine DPF client permissions (BI-F90A822E)

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` before a success claim, and `dpf-pr-with-dco` for publication.

**OBJ-CLIENT-1:** Configure routine DPF work once on Codex, Claude and Grok, with scoped commands and MCP calls, while preserving real authority limits and existing operator choices.

## Existing contract and observed defect

This implements slice D / §5 of
`docs/superpowers/specs/2026-09-02-platform-owned-client-configuration-design.md`.
The existing `packages/dpf-bootstrap/src/agent-toolchain/bridge.ts` plans connector/plugin configuration.
The bootstrap shell adapters also call the standalone
`packages/dpf-skill-pack/scripts/update_agent_toolchain.py`; its signed portal path is already delivered through `portal_source.py`.
Extend that common updater rather than create another client configuration writer.

At base `ec7d2fe41d9393180f6003b946291b83cd464fa1`, the bootstrap writes no routine permission policy. Installed versions are Codex 0.164.0-alpha.11.1, Claude 2.1.200, Grok 1.0.52.
The active Codex chat has managed workspace-write/automatic review, while saved CLI settings differ. Codex's read-only startup requirement probe reports no CLI requirements; this does not establish this chat's embedding policy.
Grok's native `inspect --json` reports runtime DPF trusted, but both the source root and this governed worktree untrusted. Claude's source root already has accepted trust. A shared legacy Claude allow rule contains a credential; never copy raw remembered command history into policy or reports.

## Chosen approach

Compared prose-only instructions, unconditional global bypass, and scoped native client rules. Use scoped native rules. Prose cannot change enforcement; global bypass would affect unrelated work. Client configuration is ergonomic and confers no DPF authority.

A delivered `packages/dpf-skill-pack/contracts/client-permission-baseline.json` owns the curated command prefixes and DPF MCP namespaces.
A focused `packages/dpf-skill-pack/scripts/routine_permissions.py` plans and applies that policy through the existing updater's explicit `--project-root`.
Both bootstrap adapters call the same `--permissions-only` route. The ordinary updater uses the same implementation when a project root was supplied. No duplicate policy in the TypeScript bridge.

- Codex: project-local `.codex/config.toml` and `.codex/rules/dpf-routine.rules`; explicit workspace-write/network and automatic review defaults, scoped source/workspace roots, and current project trust through its documented user config. Keep explicit restrictive choices, existing rules and managed requirements. Do not set full access.
- Claude: merge curated commands and configured DPF MCP namespaces into project `.claude/settings.local.json`, defaulting unset posture to `acceptEdits`. Retain deny/ask rules, hooks, explicit modes, models and provider settings. Use the existing accepted main-checkout trust; report unresolved trust instead of fabricating acceptance.
- Grok: project `.grok/config.toml` permission rules. Its permission mode and sandbox settings belong in user configuration; default an absent mode to automatic review, retain explicit choices, and report platform limitations. Establish trust for only the explicitly supplied DPF project through the documented native `--trust` path, without a model turn. Preserve managed locks and folder-trust enforcement.

Project-scoped rules cover only the named project. The allowlist has no passwords, tokens, whole-shell wildcard, provider account creation or new spend authorization.
A refusal remains a refusal. Existing server grants, consequence checks, hooks, PR protection and paired-peer limits remain authoritative.
Never suppress managed settings or change model/provider selection.

## Ordered implementation

1. Reproduce the missing scoped updater contract with a failing dry-run/unit test.
2. Add the shared declarative policy and pure planning/validation helpers. Parse and validate existing TOML/JSON before writes; preserve unrelated semantic content and reject malformed/unsupported structures.
3. Apply only planned paths, back up changed existing files, refuse unexpected concurrent edits or links, and make a second application a no-op. Dry-run performs no writes, CLI trust changes or model calls.
4. Wire the one implementation into standalone, signed-portal forwarding and both bootstrap adapters. Keep client failures separately observable; do not turn a partial repair into a ready claim.
5. Record versions, source/trust, configured posture, rules and managed constraints using sanitized metadata. Saved configuration is not evidence that an existing managed chat changed. Keep restart/effective-session verification explicit.
6. Test parser failure, deny/ask preservation, user mode/model/provider preservation, idempotence, dry-run, exact path boundaries, command/MCP matching and native diagnostics. Validate Codex rules with `codex execpolicy check`, Grok discovery with `grok inspect --json`, and installed client parsing without model turns or provider spend.
7. Run required source/shared gates and independent review, publish one protected PR, and consume the canonical release through the signed updater. Apply the reviewed scoped baseline here and verify routine source/MCP/authentication operations with a meaningful negative control. Do not manually publish public tags/images or bypass actual host refusals.

Flow: `explicit DPF project -> shared policy -> planned scoped writes -> native client discovery -> existing server authority -> sanitized evidence`.

## Acceptance criteria

| ID | Objective | Statement |
|---|---|---|
| AC-CLIENT-1 | OBJ-CLIENT-1 | Bootstrap writes a permission allowlist for each supported surface. |
| AC-CLIENT-2 | OBJ-CLIENT-1 | A deliberate approval/sandbox posture is set rather than inherited. |
| AC-CLIENT-3 | OBJ-CLIENT-1 | Model selection remains unset by DPF. |
| AC-CLIENT-4 | OBJ-CLIENT-1 | No allowlist entry is relied on for correctness or safety. |

The operator's DEV clarification also requires source/worktree roots, effective session posture, network/provider destinations, granular MCP grants and local credentials to be measured separately. Routine work and existing scoped review delegation must not ask again merely because a phase changed. External-provider consent, new spend and authority outside existing delegation retain their controls.

## Verification and rollback

Verification references:
- `packages/dpf-skill-pack/scripts/routine_permissions_test.py`
- `packages/dpf-skill-pack/scripts/update_agent_toolchain_test.py`
- `scripts/dpf-bootstrap-agent-toolchain.ps1`
- `scripts/dpf-bootstrap-agent-toolchain.sh`

The `contracts/client-permission-baseline.json` policy, `routine_permissions.py` planner and existing updater entry point are contract references for CLIENT-R1.
No schema migration or permission ledger is introduced. The report is configuration evidence only.
Rollback uses the recorded file backups and one source PR revert; do not erase unrelated operator edits. Native sandbox/managed overrides may prevent full automation; identify the actual layer and supported remedy rather than promising a file edit changed it.

## Backlog coverage

Implementation parent: **BI-F90A822E**. Atomic deliverable **CLIENT-R1** covers AC-CLIENT-1 through AC-CLIENT-4. The shared policy, native adapters, diagnostics and rollback must ship together: a partial adapter or a policy without its enforcement/discovery checks cannot satisfy surface parity. There are no independent child deliverables or implementation dependencies on the separate server repair BI-D95FD249.

Record the immutable plan through `record_plan_backlog_coverage`; its live receipt is authoritative. Do not claim that receipt before the write succeeds.
