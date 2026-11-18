---
status: draft
---

# One driver per client, routed by instance (S3, BI-A01B06F6)

**Backlog item:** `BI-A01B06F6`

Slice S3 of the T3 absorption ([spec](../specs/2026-11-13-t3-code-absorption-design.md), "Target architecture" item 2 and "Rooms and agent dialog" rows S3 and "Executor instances"). Decision DI-300A68C07417 (reproduce one driver per client). Depends on S2 (BI-C64EDA33), which landed in #7077, #7079 and #7081.

Pattern source: T3 Code's `ProviderDriver` and `ProviderInstance` (`packages/provider-core/src/server/driver.ts`) and `ProviderInstanceRegistry` (`apps/server/src/provider/ProviderInstanceRegistry.ts`), read at pingdotgg/t3code@eb8185560f38 (MIT). DPF reproduces the design on its own substrate. No T3 code is copied.

**Status: draft.** This record covers the research and design gates. Code starts only after independent spec approval and plan review.

## What this improves for Build Studio

Today a fix to how DPF drives Codex or Claude has to be made up to four times. Build Studio, Ideate, Workroom sessions and inference routing each start the CLI their own way, read its output their own way and handle its failures their own way. When one path learns to report usage, recover from a quota stop or pass a new flag, the others do not get it. After S3, each client has one driver, and Build Studio, Ideate, Workroom and routing all call it. S4 (plan windows and usage) and S5 (per-session tool ceiling) then land once instead of four times.

## Problem (origin/main 2a82f1fe)

Each of Codex and Claude is started and parsed in four places:

| Path | Codex | Claude | How it runs |
|---|---|---|---|
| Workroom runtime | `workroom-runtime/codex-app-server-adapter.ts` (191 lines) | `workroom-runtime/claude-stream-adapter.ts` (135) | Long-lived `docker exec -i` session over `sandbox-launcher.ts`; implements `ExecutorAdapter` (`workroom-runtime/types.ts`) |
| Build Studio dispatch | `build/codex-dispatch.ts` (271) | `build/claude-dispatch.ts` (275) | One-shot script through `runSandboxAgentCli` (`build/sandbox/agent-cli-runtime.ts`, 480), wrapped by `build/sandbox/agents/*-agent-runner.ts` |
| Ideate dispatch | branch in `build/ideate-dispatch.ts` (852) | branch in the same file | One-shot script through `runSandboxAgentCli`, with its own stderr progress parsing per client (:678-700) |
| Inference routing | `routing/codex-cli-adapter.ts` (562) | `routing/cli-adapter.ts` (726) | `ExecutionAdapterHandler` registered by adapter type `codex-cli` / `claude-cli` |

Consequences, read on origin/main:

- Auth is resolved three ways: `resolveCliAuth` (`routing/cli-adapter.ts:100`), `prepareCodexCliAuth` (`routing/codex-cli-adapter.ts:214`) and `injectCodexAuth` (`build/codex-dispatch.ts:47`). The workroom runtime borrows the first and a catalog variant (`runtime-tools.ts:32-33`).
- `TOOL_TRACE_KEYWORD_PATTERN` and `extractMentionedPlatformToolNames` are defined twice, identically (`routing/cli-adapter.ts:154-156`, `routing/codex-cli-adapter.ts:197-199`). `extractToolCalls` was already folded into `routing/extract-tool-calls.ts`.
- Failure classification (quota, auth, unsupported model) lives in `routing/codex-cli-adapter.ts:72-129` and `routing/cli-result-errors`. Build Studio's dispatchers do not use it.
- `RuntimeEvent` (`workroom-runtime/types.ts`) has no usage event, so the runtime drops usage. The Codex paths report zero usage (spec, "Plan and capacity accounting").
- Routing selects by adapter type (`claude-cli`), not by account. Capacity is held per adapter type in `CliPoolStatus` (`adapterType` is unique), so two Claude accounts share one pool row.

## Prior art compared

- **T3 Code (MIT), the pattern adopted.** A `ProviderDriver` is an integration: a kind, a config schema, a `create` that yields a `ProviderInstance`, and an optional usage reader. A `ProviderInstance` is one account and configuration, with an `instanceId` and a `continuationIdentity`. Each instance exposes two faces: `orchestrationAdapter` (sessions, turns, steer, interrupt, runtime requests) and `textGeneration` (one-shot text). Routing and threads hold `instanceId`; the provider's own ids are references. DPF adopts the two-face instance and routing by instance. DPF rejects T3's `ProviderInstanceRegistry` as a separate store, because `AiProviderConnection` is already DPF's per-account record (below).
- **Agent Client Protocol (Apache-2.0, `@agentclientprotocol/sdk`), the standard followed for new clients.** ACP is the open session/turn/permission protocol T3 uses for Grok, Antigravity and other registry agents. DPF's driver contract matches ACP's session, prompt, cancel and permission-request operations so an ACP driver fits without a second contract. The ACP driver itself is not in S3 (see Scope).
- **Vercel AI SDK provider registry (Apache-2.0), compared and not taken.** It models a provider as a factory of language models selected by `provider:model` id. That fits stateless text calls but has no session, steer, interrupt or runtime-request face. It would cover only the routing path, so it would leave three paths in place.
- **DPF's own `ExecutorAdapter` (`workroom-runtime/types.ts`), the closest local model.** It was already adopted from T3's orchestration adapter (BI-05715F4C) and has the session face. S3 promotes it to the driver contract instead of adding a new one.

## Options considered

1. **Promote `ExecutorAdapter` to the driver contract; one-shot callers run one turn on a session; instance = `AiProviderConnection`.** Chosen.
2. **Keep three call styles behind a shared helper module (auth, parsing, failure classes).** Rejected. It removes the duplicated parsers but leaves four ways to start each CLI, so S4's usage and S5's per-session ceiling would still be added four times.
3. **Adopt T3's provider packages as code.** Rejected by DI-300A68C07417: they are bound to Effect and T3's orchestrator.
4. **Add an `ExecutorInstance` table.** Rejected. `AiProviderConnection` already carries one account per row with `providerId`, `executionChannel`, `authMethod`, `credentialEntryId`, `accessibleModelIds` and its own `capacityStatus`/`quotaStatus` links. A second table would make two account records ([verify substrate first]).

## Design

### Driver contract: `apps/web/lib/executor-drivers/`

`workroom-runtime/types.ts` moves to `executor-drivers/types.ts` and gains:

- `ExecutorDriver { kind: "codex" | "claude"; capabilities; openSession(instance, config, onEvent); generateText(instance, request) }`.
- `capabilities` is explicit: `steer`, `interrupt`, `runtimeRequests`, `resumeThread`, `usage`, `nativeTools`. A caller that needs a capability the driver lacks gets a typed `capability-unavailable` result, and routing policy decides what happens next (AC-2). Nothing is inferred from the client name.
- `RuntimeEvent` gains `{ type: "usage"; turnId; inputTokens; outputTokens; cachedInputTokens; reported: "native" | "unknown" }`. Unknown usage is recorded as unknown, never as zero.
- `generateText` is the text face, used by routing. It is implemented on the driver as one session, one turn, close; drivers may override it with a cheaper native call (Claude `-p --output-format stream-json`, Codex `exec --json`) as long as the result passes the same conformance tests.
- One auth function per driver, taking the instance. The three current auth resolvers fold into it.
- One failure classifier per driver (`quota`, `auth`, `model`, `unclassified`), moved from `routing/codex-cli-adapter.ts:72-129` and `cli-result-errors`.

The process launcher stays where it is (`sandbox-launcher.ts`, `runSandboxAgentCli`). Drivers receive a launcher; S6 later supplies a host launcher through the same seam.

### Instance: `AiProviderConnection`

An instance is a row of `AiProviderConnection` with a driver-capable `executionChannel`. Routing resolves a request to a `connectionId`, then to its driver. In GAID form it is `gaid:…:agt-ext-<client>#instance=<connectionId>`, never a sender identity (spec, "Executor instances"). No schema change in S3. Moving capacity from `CliPoolStatus` to the connection's own `capacityStatus` is S4.

### Callers

- **Workroom runtime:** `runtime-tools.ts` gets its drivers from `executor-drivers/registry.ts`. The supervised-session port (`SupervisedSessionPort`: `isLive`, `deliver`), `addressedAs`, `deliveredCursor` and the turn prompt are unchanged; each driver still implements the port through its session (spec, "Rooms and agent dialog", row S3).
- **Build Studio and Ideate:** `codex-agent-runner.ts` and `claude-agent-runner.ts` call `driver.openSession` and run one turn. Their CLI flags, credential files and stdout parsing are deleted from `codex-dispatch.ts`, `claude-dispatch.ts` and the Codex/Claude branches of `ideate-dispatch.ts`. Ideate's progress lines come from driver `message` events instead of stderr patterns.
- **Inference routing:** `routing/cli-adapter.ts` and `routing/codex-cli-adapter.ts` become thin `ExecutionAdapterHandler`s over `driver.generateText`. The duplicated tool-trace pattern is deleted from one of them.

### What is measured, not assumed

Build Studio today runs `codex exec` as root and `claude -p` as the node user. Running them as a session turn may change the user, working directory or sandbox flags. PR 2 records the effective user, cwd and flags before and after for each client in a test, and keeps the current values unless the change is stated in the PR.

## Scope

In S3: the Codex and Claude drivers and their four call paths (PR 1 to PR 3), then an ACP driver for Grok and Antigravity on the same contract (PR 4), as the spec's target architecture item 2 names.

Not in S3: OpenCode (`build/opencode-dispatch.ts`) and the native DPF runner. The item covers Codex, Claude, Grok and Antigravity only.

Open question for spec approval: the item is sized medium. PR 4 adds a third driver and a new protocol client. If the reviewer judges that too large for one medium slice, PR 4 moves to its own item and this plan's coverage is re-recorded.

## Delivery (four PRs, each through the full gate)

1. **PR 1, the drivers** (AC-1, AC-4). `executor-drivers/` with the contract, the Codex app-server driver and the Claude stream-json driver moved from `workroom-runtime/`, usage events, capabilities, one auth function and one failure classifier per driver. A conformance suite runs both drivers on the existing fake process (`workroom-runtime/__fixtures__/fake-process.ts`), fed with recorded CLI transcripts added in this PR, for thread, turn, steer, interrupt, runtime request, usage and each failure class. The workroom runtime switches to the registry; `adapters.test.ts`, `supervised-turn-delivery.test.ts` and `supervisor.durable.test.ts` stay green.
2. **PR 2, Build Studio and Ideate on the drivers** (AC-1, AC-3). Agent runners and Ideate call the drivers; their CLI-specific code is deleted. Test: the user/cwd/flags record above, and a Build Studio fixture run per client producing the same result object as on main.
3. **PR 3, routing by instance** (AC-2, AC-3). Routing resolves a `connectionId` and calls `generateText`. Two connections for one client route separately. A missing capability returns `capability-unavailable` and policy reroutes or holds. The duplicated tool-trace pattern and auth resolvers are deleted. The PR reports the net line count of `apps/web/lib/{routing,build,workroom-runtime,executor-drivers}` against main.
4. **PR 4, the ACP driver** (AC-1). One driver over `@agentclientprotocol/sdk` (Apache-2.0, pinned) serves Grok and Antigravity: session, prompt, cancel, permission request, and usage where the agent reports it. `build/grok-dispatch.ts` and the Grok branch of `ideate-dispatch.ts` call it. The same conformance suite runs against a recorded ACP transcript. Capabilities the agent does not report are `false`, not assumed.

## Acceptance (from the item)

The item's criteria, quoted as recorded:

- **AC-1:** "One driver per client implements thread, turn, steer, interrupt, runtime request and usage events. The three paths call it." The item counts three paths; this plan found four (Ideate is the fourth), and all four call the driver (PR 1 to PR 4).
- **AC-2:** "Routing selects an instance (account and configuration), not a client type. A missing capability is explicit and handled by policy." The instance is `AiProviderConnection` (PR 3).
- **AC-3:** "The duplicated paths and parsers are deleted. The net line count falls." (PR 2, PR 3)
- **AC-4:** "No proprietary SDK is bundled. The Claude driver uses the claude CLI stream-json interface." (PR 1)
- **Room rows:** the broker's wake, push and supervised-turn tests pass after PR 1 (spec AC-5b).

## Backlog coverage

- Decision: decomposed
- Parent: BI-A01B06F6
- Receipt: blocked-by: the coverage receipt binds a pushed plan blob, and this branch cannot be pushed until local CI passes on it; record_plan_backlog_coverage runs on the first pushed head
- Dependencies: S2 (BI-C64EDA33, done); PR 2, PR 3 and PR 4 depend on PR 1
- PR 1, the drivers -> BI-A01B06F6
- PR 2, Build Studio and Ideate on the drivers -> BI-A01B06F6
- PR 3, routing by instance -> BI-A01B06F6
- PR 4, the ACP driver -> BI-A01B06F6

[verify substrate first]: ../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
