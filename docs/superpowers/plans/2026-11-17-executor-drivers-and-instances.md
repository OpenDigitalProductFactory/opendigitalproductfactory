---
status: draft
---

# One driver per client, routed by instance (S3, BI-A01B06F6)

**Backlog item:** `BI-A01B06F6`

Slice S3 of the T3 absorption ([spec](../specs/2026-11-13-t3-code-absorption-design.md), "Target architecture" item 2 and "Rooms and agent dialog" rows S3 and "Executor instances"). Decision DI-300A68C07417 (reproduce one driver per client). Depends on S2 (BI-C64EDA33), which landed in #7077, #7079 and #7081.

Pattern source: T3 Code's `ProviderDriver` and `ProviderInstance` (`packages/provider-core/src/server/driver.ts`) and `ProviderInstanceRegistry` (`apps/server/src/provider/ProviderInstanceRegistry.ts`), read at pingdotgg/t3code@eb8185560f38 (MIT). DPF reproduces the design on its own substrate. No T3 code is copied.

**Status: draft.** The item is bound to the delivery-medium shape: research is recorded, implementation is allowed, and completion owes delivery evidence plus an independent acceptance check on the live install.

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

Build Studio today runs `codex exec` as root and `claude -p` as the node user. Running them as a session turn may change the user, working directory or sandbox flags. PR 1 (Claude) and PR 2 (Codex) each record the effective user, cwd and flags before and after in a test, and keep the current values unless the change is stated in the PR.

## Scope

In S3: drivers for Codex, Claude, Grok and Antigravity, and all four call paths, in the item's order (below).

Not in S3: OpenCode (`build/opencode-dispatch.ts`) and the native DPF runner.

The item caps S3 at three PRs. If ACP does not fit in PR 3, work stops and the item is reshaped (ACP split to its own item) rather than opening a fourth PR.

## Delivery (the item's ordered steps, each PR through the full gate)

The item body (rewritten 2026-11-18 by the room's design-note stage) orders the work by client. This plan follows that order and adds what the measurements above require.

1. **PR 1 — Driver contract and Claude driver.** `executor-drivers/` holds the contract, capability flags, the usage event and one failure classifier. The Claude driver runs on stream-json with the single tool-trace parser. Workroom runtime, Build Studio `claude -p` dispatch, the Claude branch of Ideate and the routing `cli-adapter` move onto it; the Claude-side duplicates are deleted. Tests: a conformance suite on the existing fake process (`workroom-runtime/__fixtures__/fake-process.ts`) fed with recorded CLI transcripts; `adapters.test.ts`, `supervised-turn-delivery.test.ts` and `supervisor.durable.test.ts` stay green; the user/cwd/flags record for Claude (node user today) matches main.
2. **PR 2 — Codex driver.** Codex on `codex app-server`. Workroom runtime, Build Studio `codex exec` dispatch (`codex-dispatch.ts`), the Codex branch of `ideate-dispatch.ts` and `codex-cli-adapter.ts` move onto it; the Codex-side duplicates and the second tool-trace pattern are deleted. Tests: the same conformance suite; the user/cwd/flags record for Codex (root today) matches main or the change is stated; a Build Studio fixture run per client producing the same result object as on main.
3. **PR 3 — Instances and ACP.** An instance is an `AiProviderConnection` row (no new table); routing resolves a `connectionId`, then its driver, and applies policy when a capability is missing (`capability-unavailable`). Capability probes read driver flags. Two connections for one client route separately. The ACP driver over `@agentclientprotocol/sdk` serves Grok and Antigravity, and `build/grok-dispatch.ts` calls it; the same conformance suite runs against a recorded ACP transcript. The PR reports the net line count across the three PRs against main.

## Acceptance (from the item)

The item's acceptance section, exactly as recorded on BI-A01B06F6 (2026-11-18):

> AC-1: One driver per client (Codex, Claude, Grok, Antigravity) implements thread, turn, steer, interrupt, runtime request and usage events, or declares the missing capability explicitly. Workroom runtime, Build Studio dispatch and inference routing all call it.
> AC-2: Routing selects an instance (account and configuration), not a client type. A missing capability is explicit and handled by policy.
> AC-3: The duplicated paths and parsers are deleted. The net line count falls.
> AC-4: No proprietary SDK is bundled. The Claude driver uses the claude CLI stream-json interface.
> AC-5: Room delivery is unchanged in behaviour: a supervised turn is delivered at most once, `addressedAs`/`deliveredCursor` and the turn prompt are preserved, and instance ids never appear as a sender identity.

How this plan meets each:

- **AC-1:** PR 1 to PR 3. Ideate counts as part of Build Studio dispatch and moves with its client.
- **AC-2:** PR 3, with `AiProviderConnection` as the instance.
- **AC-3:** PR 1 and PR 2 delete the per-client duplicates; PR 3 reports the net line count.
- **AC-4:** PR 1.
- **AC-5:** every PR keeps `SupervisedSessionPort` and the broker's wake, push and supervised-turn tests green (spec AC-5b).

## Backlog coverage

- Decision: decomposed
- Parent: BI-A01B06F6
- Receipt: blocked-by: the coverage receipt binds this pushed plan blob, so it is recorded after this commit is pushed
- Dependencies: S2 (BI-C64EDA33, done); PR 2 and PR 3 depend on PR 1
- PR 1 — Driver contract and Claude driver -> BI-A01B06F6
- PR 2 — Codex driver -> BI-A01B06F6
- PR 3 — Instances and ACP -> BI-A01B06F6

[verify substrate first]: ../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
