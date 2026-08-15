# @dpf/bootstrap

Pure planning library for the DPF agent toolchain bootstrap. Decides every TOML / JSON / memory delta needed to converge a contributor's Claude Code + Codex CLI session to a known kernel-aware state. The shell adapters (`scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}`) apply the writes; this package owns the contract.

See:
- Spec: [docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md](../../docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md)
- Plan: [docs/superpowers/plans/2026-05-26-agent-toolchain-bootstrap.md](../../docs/superpowers/plans/2026-05-26-agent-toolchain-bootstrap.md)
- BI: BI-4B17051B under EP-INSTALL-HARDENING-2026-05-23

## Architectural rule

Installer scripts are orchestration adapters, not config parsers. If a script needs to decide whether a TOML / JSON / memory file changes, that decision belongs in this package and its tests. No regex edits of structured config in shell.

## Client-native integration rule

Agent clients are integrated through their supported surfaces first: plugin
manifests and marketplaces for skills/plugins, MCP descriptor shapes for MCP,
and the client's hook plane for hooks. Direct user-config writes are fallback
adapter work only when the client has no non-interactive native command for the
state DPF must converge.

Fallback edits still go through this planning library, not shell string patches.
For Codex, `planCodexConfig` parses and stringifies TOML with `smol-toml`. The
only pre-parse text repair it may perform is the known invalid state where
`~/.codex/config.toml` already has duplicate `[mcp_servers.dpf]` tables. That
repair collapses DPF's own duplicate block so the file can parse again, then the
normal schema-aware planner owns the write. It never appends blindly and never
deletes user-owned config.

Codex and Claude Code are known lazy-tool hosts: they index an authorized MCP
catalog and attach only task-relevant definitions to the model. Their generated
DPF endpoints therefore carry the server's explicit `?tier=full` catalog hint.
This is not a least-authority expansion—the server still grant-filters the list,
and the host still owns model attachment. Grok, VS Code, Antigravity, and generic
MCP clients keep the no-query endpoint and its lean core default. Re-running the
bootstrap migrates an older no-tier Codex config idempotently.

## Public surface

```ts
import {
  planClaudeCodePluginConfig,
  planCodexConfig,
  planKernelMemorySeed,
  planMcpReadinessProbe,
  interpretMcpReadinessResponse,
  renderSmokeTestScenario,
  interpretSmokeResponse,
  redactTranscriptForPersistence,
  materializeAgentToolchainState,
  computeReadinessState,
  readinessCopy,
} from "@dpf/bootstrap/agent-toolchain";
```

Every planning function is data-in / data-out — no filesystem writes, no network, no spawn. Tests cover idempotence, byte preservation, user-intent preservation, bearer redaction, and stale-entry plans against fixtures captured from the operator's real configs.

## Bearer-token discipline

Every fixture, every test, every persisted state-file shape is bearer-redacted. `redactTranscriptForPersistence` is the runtime gate; `fixtures-redaction.test.ts` is the structural gate. A bearer leak in a PR is a security regression.
