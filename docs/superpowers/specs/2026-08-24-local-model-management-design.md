---
status: active
---

# Local model management design

**Backlog item:** BI-1FFDF4B1  
**Status:** Active
**Owning area:** Platform / AI providers  
**Primary route:** `/platform/ai/providers/local`

## Problem

The local-provider page currently applies the cloud-provider account posture form to Docker Model Runner, maps every installed model size to zero, and replaces install and remove actions with terminal commands. The result is internally inconsistent: a page that claims to manage an on-box runtime cannot report its disk use or perform its two primary mutations.

Live evidence from the development install on 2026-08-24:

- DMR `GET /models` reported `docker.io/ai/nomic-embed-text-v1.5:latest` at `260.86MiB` and `huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M` at `17.66GiB`.
- The current OpenAI-compatible `/v1/models` adapter discards that metadata and constructs `size: 0` for every row.
- `pullOllamaModel` and `deleteOllamaModel` are unconditional failure stubs whose errors instruct the operator to run PowerShell or Docker CLI commands.
- The provider page renders `ProviderAccountPostureForm` for every non-service provider, including the bundled `local` and legacy `ollama` provider IDs.

Docker documents native model-management endpoints for `GET /models`, `POST /models/create`, and `DELETE /models/{namespace}/{name}`. The runtime source confirms that create accepts `{ "from": "<model-reference>" }`, streams pull progress, and that the delete route accepts the complete namespaced reference.

## Research and benchmarking

| Runtime | Management pattern | Adopted or rejected |
|---|---|---|
| Docker Model Runner | Separates OpenAI-compatible inference from native `GET /models`, `POST /models/create`, and namespaced `DELETE /models/...` management endpoints. Create streams progress. | **Adopted.** DPF is installed with DMR, so its native API is the authority. The compatibility endpoint remains for inference only. |
| Ollama | Exposes direct local `POST /api/pull` and `DELETE /api/delete` operations, with pull progress streamed by default. | **Pattern adopted, protocol rejected.** It confirms that local model management belongs behind HTTP rather than a copied CLI command. DPF must not pretend the DMR runtime is Ollama when the native DMR contract is available. |
| LM Studio 0.4 | Its native v1 REST API separates list, download, load/unload, and download-status operations from OpenAI compatibility. | **Pattern adopted, protocol rejected.** The status projection reinforces an observable background download. LM Studio is not the installed runtime and does not belong in this adapter. |

The DPF unified connector kernel is adjacent but not the ownership boundary: DMR is a bundled deployment capability, not a third-party connector with credentials or callbacks. This design adopts the kernel's safe-failure and durable-refresh rules without registering DMR as an integration connector.

## Design grounding

- **Existing specs/plans reviewed:** the provider-connection guide, platform usability standards, portal UX simplification spine, background-operation observation contract, and deployment contracts.
- **Current code substrate reviewed:** the provider detail route, `OllamaManagement`, canonical local-provider classification, DMR URL derivation, `ScheduledJob`, the Inngest queue registry, shared system-event fan-out, model discovery, and model profiling.
- **Source of truth:** native DMR `/models` owns installed model facts; `ScheduledJob` owns durable install progress; `DiscoveredModel` and `ModelProfile` remain routing projections.
- **Decision:** retain the existing provider-detail home, remove cloud posture from local providers, use native HTTP management with a durable install job, and reconcile routing automatically. No host-command bridge, new provider, or new database model is introduced.

## Objectives and requirements

- **R1 — Local posture:** bundled local provider pages must not render cloud account class, provider-training, DPA, or processing-region declarations. Cloud providers retain the existing form.
- **R2 — Accurate inventory:** installed models come from DMR's native list endpoint, including digest, created time, parameters, quantization, and size.
- **R3 — Honest unknowns:** absent or unparseable size metadata is `null` and renders as “Size unavailable”; it never becomes zero.
- **R4 — In-product install:** an authorized operator can install a catalog or validated custom model from the page without a shell, script, clipboard, or host bridge.
- **R5 — Durable install:** a model download continues independently of the browser request and exposes queued, downloading, completed, and failed states.
- **R6 — In-product remove:** an authorized operator can confirm removal and DPF calls the native delete endpoint directly.
- **R7 — Consequence clarity:** removing the embedding model warns that semantic search and durable memory will be unavailable until an embedding model is installed. Removing a generation model warns that routes using it will stop working until routing is reconciled.
- **R8 — Automatic reconciliation:** completed install and remove flows refresh installed inventory and reconcile discovered/profiled routing state without a manual Refresh step.
- **R9 — Legacy behavior:** a runtime without native management endpoints returns an explicit “management unavailable; update the local runtime” result. It does not fall back to terminal instructions.
- **R10 — Authorization and validation:** every read or mutation requires `manage_provider_connections`; model references are length-bounded and reject URLs, query strings, fragments, traversal, backslashes, whitespace, and control characters.
- **R11 — Observable async UX:** actions use the shared busy/status patterns, live-region announcements, disabled duplicate controls, and bounded background-state observation.
- **R12 — Measured fit:** the exact route is verified in dark and light themes at desktop and narrow widths, with a measured UX-fit artifact.
- **R13 — Safe HTTP failures:** the net-new JSON status route returns bounded `application/problem+json` failures with a stable DPF problem type and request correlation ID.
- **R14 — Governed reviewer:** Qwen3.8 27B remains the governed high-trust local reviewer. The catalog names that role explicitly; a low-memory catalog choice cannot override it through a generic recommendation flag.
- **R15 — Bounded reviewer latency:** the governed reviewer defaults to 600,000 ms. An authorized autonomous activity with a persisted immutable parent deadline may use only the time remaining before that deadline, including queue wait and fallback. Generic local overrides remain capped at 600,000 ms. Autonomous origin alone never grants a longer window. See the BI-03AC2FD9 repair sequence below; that exception remains proposed until implemented and verified.
- **R16 — Observable runtime:** the authenticated status projection exposes the reviewer model, effective timeout, timeout source, ceiling, and live served-context facts without exposing environment values.

## Architecture

### Sources of truth

| Concern | Authority | Projection/consumer |
|---|---|---|
| Installed model bytes and metadata | Docker Model Runner `GET /models` | Local-model inventory view model |
| Install operation lifecycle | Existing `ScheduledJob` manual-job row keyed by normalized model reference | Authenticated status route and background observer |
| Background execution | Existing Inngest event/function substrate | DMR `POST /models/create` |
| Routable model catalog | Existing `DiscoveredModel` and `ModelProfile` records | Provider routing and model cards |
| Local/cloud classification | Existing `isLocalProviderId` routing primitive | Provider detail composition |
| Fresh-install model choice | `scripts/installer/local-model-policy.json` from PR #4624 | Installers and host detection |
| Governed reviewer runtime | `lib/routing/local-inference-runtime-policy.ts` | Chat adapter and authenticated diagnostics |
| Effective served context | DMR `_configure` through `resolveServedContextInfo` | Authenticated diagnostics |

No new database model, provider, or host-shell capability is introduced. `ScheduledJob` already carries manually triggered inference evaluation/probe state; a deterministic `local-model-install:<sha256>` job ID gives each model one bounded, retry-safe operation row. Its metadata contains only the validated model reference, requested-by ID, byte progress, total bytes, message, and timestamps.

The operation states are a closed TypeScript union—`queued`, `running`, `completed`, and `failed`—defined in the management module and imported by the action, queue function, route, and UI. Persistence stores those canonical strings; no second UI-only status vocabulary is allowed.

### Contracts

- **C1 — Runtime authority:** native DMR inventory is authoritative for installed model facts; OpenAI compatibility is not a management source.
- **C2 — Validated management root:** callers can supply a model reference, never a URL. The server derives the root through `getOllamaApiRoot`.
- **C3 — Manual-job receipt:** one deterministic `ScheduledJob` row per validated reference owns the DPF install lifecycle; its metadata is a validated projection, not installed-model authority.
- **C4 — Queue execution:** installs run in a concurrency-one Inngest function with duplicate admission and quiescence guards.
- **C5 — Locality composition:** the canonical `isLocalProviderId` primitive decides whether cloud posture controls apply.
- **C6 — Honest view model:** byte counts remain nullable end to end and unknown data is named, never converted to zero.
- **C7 — UX and route projection:** the existing provider route owns the workflow; generated route/doc projections and measured UX-fit evidence change with it.
- **C8 — Separate policy questions:** the installer selects a broadly compatible initial model; the reviewer-runtime policy identifies the trusted reviewer and its latency budget. Neither is projected as the other's recommendation.
- **C9 — One timeout resolver:** chat dispatch and diagnostics consume the same pure runtime-policy resolver. Diagnostics distinguish the default model timeout from an activity-specific deadline. The server executor binds the latter to persisted authority and its current generation; callers cannot confer it through a request duration. Queue admission and provider dispatch recompute remaining time, and cancellation or generation loss prevents further dispatch and stale writes.

### F1 — Read flow

1. The authenticated status route reads native DMR inventory and active/recent local-model install rows.
2. The adapter maps human-readable IEC sizes to integer bytes and preserves `null` when size is absent.
3. Runtime tag aliases (`docker.io/...:latest`, `huggingface.co/...`, and pull-form `hf.co/...`) are reduced to a comparison key without changing the reference sent to DMR.
4. The client derives total disk use only from known bytes and labels partial totals when any installed model lacks size metadata.

### F2 — Install flow

1. The server action authorizes the caller and validates the supplied reference.
2. It rejects a duplicate active install, upserts the deterministic manual-job receipt as `queued`, and sends `inference/local-model.install`.
3. The Inngest function passes the quiescence entry gate, marks the receipt `running`, and calls native `POST /models/create` with `{ from }`.
4. The runtime stream is consumed to completion. Progress writes are throttled and update known byte totals/message without treating absent totals as zero.
5. Success runs the existing local-provider discovery/profile reconciliation, marks the receipt `completed`, and emits a local-model system invalidation event. Failure records a short operator-safe message and emits the same invalidation.
6. The UI rehydrates the narrow status projection on invalidation; bounded polling is used only while an operation is active and the event transport is unavailable.

The queue function has concurrency one because local model pulls contend for the same disk, network, and runtime store. Its deterministic job key and active-state check make retries and duplicate clicks idempotent.

### F3 — Remove flow

1. The UI opens an inline confirmation containing the specific capability consequence.
2. The authorized action validates the installed runtime reference and calls the native delete URL using path-segment encoding while preserving its namespace depth.
3. A successful delete invokes existing discovery/profile reconciliation and returns the refreshed status snapshot.
4. `404` means the model is already absent and is treated as an idempotent success; unsupported management endpoints produce R9's update-needed state.

Remove is not queued because the local API operation is short. The confirmation and permission boundary remain in DPF; there is no generic command execution seam.

### F4 — Verification flow

The focused unit/component suites establish behavior first. Generated route/doc companions, prose/style guards, and exact-tree CI then check the repository projection. Finally, the governed nonproduction install exercises the actual local route and runtime API; structural checks are not accepted as functional proof.

### Scale ceiling

DMR's local policy permits one generation model plus small supporting models, and installs execute with global concurrency one. The status projection reads all active local-model jobs plus at most the 100 most recently updated terminal receipts; it never performs an unbounded `ScheduledJob` scan. This supports a workstation catalog far beyond the current policy while bounding route cost. If an install needs fleet-scale catalogs, concurrent downloads, or longer history, EP-56AE0F69 owns the follow-on decomposition into paged operation history and resource-aware concurrency; this slice will not silently raise the cap.

## UX fit decision

**Decision: fits with guardrails.** This is a contextual management workflow on the existing Platform provider-detail route, not a new top-level destination.

### UX fit review — governed reviewer label

- **Decision:** fits.
- **Owning area / route:** Platform, on the existing `/platform/ai/providers/local` detail family.
- **Primary persona:** platform operator choosing an on-box model; they should not need to infer trust from model size or an unexplained star.
- **Navigation / AI boundary:** no navigation layer changes and the label starts no coworker work.
- **Reuse:** the existing catalog row and report-kit `StatusBadge`; no new badge primitive or color map.
- **Source truth:** `lib/routing/local-inference-runtime-policy.ts` owns the reviewer identity and timeout; DMR owns served context; PR #4624's installer policy remains a separate initial-selection authority.
- **Empty/failure behavior:** unchanged. The label appears only on the governed catalog entry; existing unavailable, permission, and management failure states remain authoritative.
- **Evidence before merge:** catalog/component/route tests, prose/style/module guards, exact-tree gate, and the existing measured UX-fit manifest.
- **Captured in:** this section and `docs/ux-fit/2026-08-24-local-model-management.ux-fit.json`.

- **Persona:** founder/operator or platform operator managing on-box AI capacity.
- **Primary question:** “What is installed, how much space does it use, and can I change it here?”
- **First viewport:** local status and installed inventory, followed by the model catalog. Cloud contract questions are absent.
- **Primary actions:** Install on an uninstalled catalog row; Remove on an installed row. Refresh remains a secondary recovery action, not a required workflow step.
- **Disclosure:** custom reference install remains in an Advanced disclosure. It performs Install directly and explains accepted reference formats; it never manufactures a command.
- **Empty/failure states:** distinguish no installed models, unreachable runtime, management unsupported, and unknown metadata.
- **Design substrate:** existing DPF surface/border/text/status tokens, `InlineBusy`, shared button/status conventions, and the existing provider route. No hardcoded color values.

## Security and failure contracts

- All list/status/install/remove entrypoints use the existing session and `manage_provider_connections` permission check.
- The server derives the management root only through `getOllamaApiRoot`; the user cannot supply a URL or host.
- Validation happens before job persistence or network access. Model references are treated as opaque registry identifiers after validation, never concatenated into a shell command.
- Error bodies are bounded before logging or returning. Credentials, internal response bodies, and arbitrary upstream HTML are not shown to the user.
- Unreachable runtime, unsupported endpoint, rejected reference, registry failure, queue dispatch failure, and reconciliation failure are distinct typed results.
- A reconciliation failure after successful DMR mutation is surfaced as “installed/removed, routing sync needs attention”; the mutation is not falsely reported as failed or rolled back.
- Server actions return the shared `ActionResult<T>` shape. The status route uses RFC 9457 Problem Details for failures rather than leaking raw exceptions or treating failure as an empty inventory.

## Verification contracts

- **V1 — Adapter/actions:** unit tests cover size parsing, native inventory mapping, alias comparison, validation, create request body, progress parsing, delete URL construction, `404` idempotency, legacy endpoint classification, authorization, duplicate admission, queue-dispatch failure, and post-delete reconciliation.
- **V2 — Queue lifecycle:** queue-function tests cover canonical states, progress, concurrency/idempotency behavior, success, failure, and reconciliation.
- **V3 — Route and components:** tests cover local/cloud form branching, honest sizes, Install/Remove behavior, embedding consequence copy, async announcements, safe Problem Details, and absence of terminal/script/clipboard instructions.
- **V4 — Repository and live:** existing provider, routing, event-provider, queue registry, prose, style-drift, route-manifest, type, and exact-tree guards run before governed live verification on `/platform/ai/providers/local` in dark/light themes and desktop/narrow viewports. The live path includes one reversible small-model install/remove flow where practical.
- **V5 — Reviewer runtime:** tests cover the unset/default 27B policy, an explicit 600,000 ms local override, upper-bound clamping, survival beyond the former 120,000 ms abort, catalog-role reconciliation, and status diagnostics containing the effective timeout plus served context. Infrastructure timeout evidence remains a runtime/configuration finding and never changes reviewer trust.

## Alternatives considered

1. **Call DMR directly from the server action.** Smallest diff, but a multi-gigabyte pull is tied to the browser request and has no durable operation projection. Rejected by the background-operation doctrine.
2. **Add a generic host command bridge.** Would make CLI examples executable but creates a broad remote-code-execution boundary and preserves the wrong operator workflow. Rejected.
3. **Add a new `LocalModelOperation` table.** Semantically precise, but duplicates the existing bounded manual-job carrier for one operation type. Rejected unless implementation proves `ScheduledJob` cannot carry the required state.
4. **Durable queue plus existing manual-job receipt.** Selected: uses supported DMR HTTP APIs, existing DPF persistence, existing queue semantics, and existing event-driven observation.

## References

- `docs/platform-usability-standards.md`
- `docs/architecture/orientation.md`
- `docs/architecture/deployment-contracts` Contract 9 source: `docs/superpowers/specs/2026-05-09-deployment-contracts.md`
- `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`
- Docker Model Runner REST API: <https://docs.docker.com/ai/model-runner/api-reference/>
- Docker model pull reference: <https://docs.docker.com/reference/cli/docker/model/pull/>
- Ollama pull API: <https://docs.ollama.com/api/pull>
- Ollama delete API: <https://docs.ollama.com/api/delete>
- LM Studio native REST API: <https://lmstudio.ai/docs/developer/rest>

## BI-03AC2FD9 — Parent-bounded inference repair

**Status:** implementation design; no runtime change or acceptance claimed.
**Implementation owner:** BI-03AC2FD9 / WC-183763CA.
**Decision:** WWMD DI-5DE30BBD52CC, adopted `parent-bounded-activity-deadline`.

### Reproduction and scope

On served commit `007eef1a3bc035a5f7906cf92cd2432819695534`, review
`TR-GATE-1474B7FFECA18DB8138EFDDB` lost its AGT-181 branch exactly 600 seconds
after dispatch while its immutable parent deadline still had time. Docker Model
Runner generated 6,786 tokens before the abort. Activity
`cmv5l9yk0fwbp01nses8ka87y` records this execution. The other required reviewer
completed a genuine PASS in a single 491-second request. That checkpoint must
survive recovery. This rules out the old 300-second transport ceiling for this
execution; it does not establish that every timeout has the same cause.

Current source at `f6ee7a5b1f505e3aa829027eb7d6ed6b8e91f0fe` retains the same
runtime-policy blob `1cff51ab0dc390456bcbbbe98d360e62e7a9c2a9`. Both the local
reviewer policy and the provider transport backstop are 600,000 ms. The review
executor already owns a persisted deadline, request digest, generation fence,
checkpoints and recovery counters. Extend those contracts without a new table,
request identity, recovery attempt, model selection or token/cost allowance.

Original BI acceptance, retained verbatim:

- Decide (WWMD) whether autonomous build phases on the local engine may exceed the chat ceiling, or whether ideate must be split into bounded local completions (outline, then sections) that each fit the ceiling.
- Implement the chosen path with a failing-to-passing test.
- Live proof: an ideate completes on the bundled local model with no cloud engine available.

Review recovery is the first caller with an existing immutable deadline. Ideate
must establish an authoritative persisted phase deadline before consuming this
exception. Its current origin tag and caller-supplied duration are insufficient.
The original ideate acceptance remains owed; a completed review cannot close it.

### Ordered fix sequence

This is one atomic deadline contract, delivered under BI-03AC2FD9. The steps are
internal sequencing; a timeout extension without admission, cancellation and
fencing is not independently shippable. Quota routing is separately delivered by
BI-EDF1BD54. Local admission priority is owned by BI-285EF102; coordinate its
source before touching shared admission files.

1. **D1 — Bind authority (R15, C9, F5, V6).** Add an execution-local deadline
   scope populated only by the server executor after validating the saved
   request, authority and generation. Reject malformed/expired scopes; do not
   expose an MCP/API option that can mint deadline authority. Start with the
   existing semantic-review executor and preserve immutable request fields.
2. **D2 — Enforce the remaining window (R15, C9, F5, V6).** Extend the existing
   runtime resolver and provider transport. Recompute remaining time after
   admission and before each dispatch/fallback. Compose the parent cancellation
   signal with per-call policy. Keep generic defaults and remote policy intact;
   use a finite transport backstop for the authorized local window. Do not
   increase output reserves, monetary budgets or privacy/provider authority.
3. **D3 — Cancel and fence (R15, C9, F5, V6).** Bind parent expiry, cancellation,
   current authority and generation loss to in-flight abort and queued waiter
   removal. A lost executor remains outcome-uncertain until real reconciliation.
   Late provider results never cross a fence. Completed reviewer checkpoints
   remain reusable only under their bound immutable identity. No automatic paid
   retry or new successor admission is introduced.
4. **D4 — Verify and deliver (R15, C9, F5, V6).** Run failure-injection tests,
   affected unit suites and source/test typechecks, then the exact-tree canonical
   shared gate. Obtain exact-commit independent review; use DCO PR, protected
   checks, merge queue and canonical self-upgrade. Record unavailable gates as
   unrun. After deployment reconcile real provider settlement, execute the
   supported recovery once, and retain the genuine independent verdict. The
   ideate phase deadline integration and original local-only ideate acceptance
   must also be proved before BI closure; do not manufacture a passing receipt.

### F5 — Governed call flow

Persisted parent request → authority and generation validation → execution-local
deadline scope → existing provider/privacy/budget routing → bounded admission →
remaining-time check → provider call → fenced checkpoint → genuine review receipt.
Each fallback traverses the same checks. The clock is absolute and never restarts
when a waiter enters the GPU lane. Generic chat has no such scope.

### V6 — Failure injection and acceptance

- Prove the current 600-second abort before changing it; prove a governed call
  can complete after 600 seconds but before its parent deadline after the fix.
- Prove unchanged generic defaults/clamping, rejection of malformed or expired
  authority, and no dispatch after queue wait exhausts the parent window.
- Cancel queued and running work; simulate generation loss and authority
  revocation; prove no late checkpoint, no fallback charge, and no duplicate
  provider call. Release queue listeners and timers exactly once.
- Replay expired/stale requests and duplicate recovery; reuse completed evidence
  only under its original binding and preserve all budget/deadline counters.
- Exercise the actual HTTP transport, not merely a mocked timeout resolver.
- Reuse valid prior evidence, run affected suites and package typechecks, resolve
  `gate:context` impact obligations, regenerate/check the doc index, and complete
  the canonical merged-code gate. Current workroom impact resolution names the
  doc-index guard; runtime scope claims must refresh impact before source edits.
- Live acceptance requires the affected native review's genuine verdict and the
  original local-only ideate completion. Infrastructure refusal is inconclusive.

### Risks and rollback

A longer local call occupies scarce GPU capacity longer; retain the canonical
single-flight lane and its interactive priority. Expiry must remove queued work,
not only suppress a stale result. Scope propagation could accidentally authorize
ordinary chat; fail closed without a verified server-owned scope. Canceling a
local request does not prove a remote paid request settled. Preserve uncertainty
and require runtime evidence. Roll back through a DCO revert and canonical
release, restoring the default timeout without rewriting requests or receipts.

### Standards and backlog coverage

Node's [AbortSignal API](https://nodejs.org/docs/latest/api/globals.html#class-abortsignal)
provides composed cancellation and pre-dispatch checks. Undici's
[Dispatcher contract](https://undici.nodejs.org/api/Dispatcher) distinguishes
header/body inactivity backstops from a whole-operation deadline. Consulted
2026-10-12. Neither mechanism supplies execution authority.

Research receipt: `initiative-2484c98c-a4f6-4773-8fd1-542c97876fb4`.
Plan coverage is pending immutable publication of this design and the governed
coverage write. No implementation readiness or completion is inferred here.
