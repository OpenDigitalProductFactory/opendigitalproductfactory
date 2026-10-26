---
title: Routine permissions for DPF development clients
status: draft
author: Mark Bodman
date: 2026-10-25
backlog:
  - BI-F90A822E
related:
  - docs/superpowers/specs/2026-09-02-platform-owned-client-configuration-design.md
  - docs/superpowers/plans/2026-10-25-client-routine-permissions.md
---

# Routine permissions for DPF development clients

This is the bounded implementation design for slice D / §5 of the platform-owned client configuration design. It does not approve or reimplement that parent document's worktree-janitor, runtime-mount or other slices. The client permission paths correctly raise this work to access-control review; the declared medium size does not waive those gates.

**OBJ-CLIENT-1:** Configure routine DPF work once across Codex, Claude and Grok while keeping existing authority, managed restrictions, credentials and model choices intact.

## Problem and evidence

Bootstrap configures plugins and MCP connectors but no routine command/MCP allowlist. At source `ec7d2fe41d9393180f6003b946291b83cd464fa1`, `update_agent_toolchain.py` has no scoped permission convergence route. Agents therefore accumulate remembered commands or pause for ordinary source, verification and DPF evidence work.

Observed here: Codex 0.164.0-alpha.11.1, Claude 2.1.200, Grok 1.0.52. Saved Codex settings do not describe this existing managed chat's workspace/reviewer policy. Grok's native inspection finds the runtime trusted and the source/worktree untrusted; Claude's source checkout already has accepted trust. A legacy global Claude allow rule contains a credential. New policy and reports must never copy raw remembered rules or credentials.

The operator delegates routine DEV work, existing local credentials and scoped review. External-provider consent, new spend and authority outside existing delegation still require the proper owner. An environment label grants nothing.

## Decision and source of truth

Use the existing standalone signed updater as the one permission-configuration writer. Add a delivered declarative contract at `packages/dpf-skill-pack/contracts/client-permission-baseline.json` and focused planning/application helpers in `packages/dpf-skill-pack/scripts/routine_permissions.py`. Both bootstrap shell adapters call its explicit `--permissions-only --project-root` route. Ordinary scoped updater runs use the same implementation. Do not duplicate the policy in the TypeScript bridge or introduce a permission store.

Compared prose alone, unconditional global bypass and scoped native configuration. Choose scoped native configuration: prose cannot change enforcement, and global bypass would affect unrelated work. The allowlist is an ergonomic exception list; it never proves DPF authority or substitutes for server gates, IAM, hooks, branch protection or an actual host refusal.

## Configuration contract

The caller names one existing DPF project. Reject drive roots, home directories, unrelated paths, linked configuration targets and malformed/unsupported documents. Resolve the project path canonically and plan every write before applying. Use existing TOML helpers only with whole-document semantic validation; do not accept regex edits that discard unrelated data.

Codex receives project `.codex/config.toml` and `.codex/rules/dpf-routine.rules`. Default missing posture to workspace-write, command network access and on-request with automatic review. Trust only the named project through the documented user project table; preserve an explicit untrusted decision. Keep explicit restrictive project choices and every managed requirement. Do not select full access, alter providers, or claim an existing managed chat widened.

Claude receives a merged project `.claude/settings.local.json`: default an unset mode to `acceptEdits`, merge curated routine commands and exact configured DPF MCP namespaces, and retain existing deny/ask rules, hooks and explicit modes. Existing main-checkout trust covers its worktrees according to the client; do not invent acceptance in private client state.

Grok receives project `.grok/config.toml` permission rules. Its mode and sandbox defaults are user-level settings: default absent mode to automatic review, preserve explicit choices, and report native platform support. Project trust uses the documented native `--trust` path for only the supplied project, without starting a model turn. Do not disable folder trust or edit managed policy. A native refusal stops that operation.

Curate DPF source/read/test/commit/PR commands and the configured DPF MCP server namespaces. Do not whitelist every shell or every MCP server. Scripts can execute code, so this client list is not a complete OS security boundary. DPF server grants and consequence checks remain the authority for platform operations; provider/IAM controls and the operator's scope still govern external actions.

The policy contains no passwords, tokens, model/provider choice, account creation or spending authority. Do not copy legacy allowlists into the delivered contract or diagnostic output. Preserve unrelated user settings semantically, including model and reasoning preferences. Conflicting deny/ask/managed controls remain effective and are named as constraints.

## Application, evidence and recovery

Dry-run performs no writes, native trust changes or model calls. It emits only planned paths and safe metadata. Apply backs up changed existing files, checks for concurrent changes, writes atomically, and refuses links or retargeted paths. A repeat on unchanged inputs is a no-op. Report each client separately so a failed scope cannot masquerade as a fully configured host.

Extend the existing toolchain convergence report for project-permission scope; keep configuration evidence distinct from live session proof. Include installed version, project/trust, configured posture, rule counts, platform limits, observed managed constraints and restart state. Never print raw user rules, environment values, credentials or sign-in links.

Use the native Codex parser and `execpolicy check`, Grok `inspect --json`, and supported client configuration diagnostics without model calls. A configured file is not evidence of the effective policy of this running chat. Verify routine source/MCP/local-authentication operations after supported delivery; preserve a meaningful denied/ask control. Report any untested client-session path honestly.

No schema migration, grant change, new tool, provider/model pin, public-release bypass or paired-production mutation is included. Rollback uses the recorded scoped backups without erasing later operator edits; source rollback is one PR revert.

## Acceptance

| ID | Objective | Statement |
|---|---|---|
| AC-CLIENT-1 | OBJ-CLIENT-1 | Bootstrap writes a permission allowlist for each supported surface. |
| AC-CLIENT-2 | OBJ-CLIENT-1 | A deliberate approval/sandbox posture is set rather than inherited. |
| AC-CLIENT-3 | OBJ-CLIENT-1 | Model selection remains unset by DPF. |
| AC-CLIENT-4 | OBJ-CLIENT-1 | No allowlist entry is relied on for correctness or safety. |

Verification must cover malformed documents, semantic preservation, deny/ask precedence, explicit modes, unrelated model/provider settings, dry-run, idempotence, exact scope, concurrent edits, links, native rule matching and diagnostic redaction. The bound implementation plan maps CLIENT-R1 to these four criteria. Independent design, architecture and plan review remain required by the server's raised effective shape.

## Official references

- [Codex permissions](https://learn.chatgpt.com/docs/permissions), [project configuration](https://learn.chatgpt.com/docs/config-file/config-advanced), [execution rules](https://learn.chatgpt.com/docs/agent-configuration/rules)
- [Claude permissions](https://code.claude.com/docs/en/permissions)
- [Grok permissions](https://docs.x.ai/build/features/permissions), [settings reference](https://docs.x.ai/build/settings/reference), [sandbox support](https://docs.x.ai/build/features/sandbox)
