# Make the consequential-tool gate's coverage match what it governs — plan

**Status:** phase 1 shipped · 2026-08-16
**Epic:** EP-1C37C089 (WWWD constitutional alignment gate)
**Spec context:** [`2026-08-13-wwwd-constitutional-alignment-gate.md`](../specs/2026-08-13-wwwd-constitutional-alignment-gate.md)
**Kernel decision:** `DI-D0F56A1E21D4` (composite 12.18 vs 11.97, margin 0.213)

## 1. Problem

The pre-execution governance gate shipped and works. It is fail-closed (no alignment receipt → `escalate` → the call is rejected), it **vetoes** rather than averaging (`composeAlignmentVerdicts`: any `decline` wins), and it refuses smuggled bypass arguments (`findAlignmentBypassArgument`).

Its **coverage** was the defect.

`ALIGNMENT_CONSEQUENTIAL_TOOL_NAMES` listed nine tool names. **Seven matched nothing in the codebase:**

```
create_product   create_product_line   launch_campaign   publish_storefront
send_quote       send_invoice          execute_change
```

A name that resolves to no tool gates nothing. So a list that reads like broad coverage of business-direction actions was, in effect, gating **two** real tools — `create_digital_product` and `create_marketing_campaign` — out of **~198 side-effecting** tools on the surface.

The failure is silent by construction. Nothing errors when a gate names a tool that does not exist, and nothing errors when a tool that spends money ships with no classification. The existing policy test even asserted Work Room shapes for `send_quote` and `execute_change`; it passed, because the classifier is keyed on a bare string and will happily classify a name nothing can call.

**Nothing declared irreversibility.** `ToolDefinition` carried `sideEffect`, which is equally true of `update_backlog_item` and `place_linkedin_ad`. Whether an effect can be undone was recoverable from neither the name, the schema, nor the flag — only from a hand-maintained list that had rotted.

### What was ungated

Found by hand (a name-pattern sweep missed the worst of them):

| Tool | Why it matters |
|---|---|
| `place_linkedin_ad` | places a paid ad campaign — **money leaves the business** |
| `send_marketing_email` | email to real recipients; unrecallable |
| `publish_to_linkedin` | public post under the org's identity |
| `tick_marketing_scheduler` | **fan-out**: dispatches every due `ScheduledOutboundAction` at once |
| `create_portal_pr` | publishes a branch to the remote |
| `contribute_to_hive` | publishes a FeaturePack to the community commons |
| `admin_run_command` | shell execution |
| `apply_platform_update`, `deploy_feature`, `execute_promotion` | change the running system |
| `merge_customer_accounts` / `_contacts` | collapses identity records |
| `manage_coworker_tool_grant` | **mutates the authorization model itself** |

Several of these carry "only call after the user has explicitly approved" **in the tool description**. That is an instruction to a model, not an enforced gate — governance by politeness, which is exactly what a pre-execution interceptor exists to replace.

## 2. Phase 1 — declared reach (this PR)

**`ToolDefinition.consequence`** — a closed axis, `"outward" | "irreversible"`, declared by the tool's author because that is the only place the fact lives.

- **`outward`** — the effect leaves the platform: reaches a third party, publishes externally, or spends money. The business's own WWWD stance governs whether it should happen → **alignment-gated**.
- **`irreversible`** — the effect stays inside, but no inverse call restores the prior state → **consequential** (audit row, execution receipt, reservation) but **not** alignment-gated.

**The asymmetry is deliberate.** A business stance has nothing to say about `admin_run_command`; capability and authority govern those. Routing internal platform operations through the WWWD corpus would manufacture escalations, not safety — and a gate that cries wolf gets bypassed. Alignment is spent where the business's own direction is genuinely the question: what leaves the business.

`classifyConsequentialTool` reads the declaration first; the legacy name list survives only for the two tools that predate the axis, with its dead names removed.

**Conformance (`consequential-tool-coverage.test.ts`)** — the drift, not the list, was the defect:
1. every name in the alignment list resolves to a registered tool;
2. every tool in the pinned declared set is registered, still declares its reach, and actually mutates;
3. no tool declares a consequence without a side effect;
4. `outward` classifies as alignment-required + `outward-review`; `irreversible` as consequential + not alignment-required.

The pinned set is the review surface: widening what an agent may do to the outside world without a human noticing now requires editing a list whose diff says so.

## 3. Operational consequence — read before upgrading

This **changes runtime behaviour** for outward marketing actions. Once live, `send_marketing_email`, `publish_to_linkedin`, `place_linkedin_ad` and `tick_marketing_scheduler` must clear the WWWD alignment gate. If the organization's stance corpus is thin or unembedded, the gate is fail-closed and will **escalate rather than fire**.

That is the intended behaviour — it is the platform promise ("keep humans in control of consequential automated decisions") applied to the actions that most obviously need it. But it is a real change to how autopilot behaves, and it reaches the live install only when the operator runs `/ops/self-upgrade`. An org running outbound marketing on autopilot should expect escalations until its stance corpus answers the question.

## 4. Out of scope — named, not silently dropped

**~180 side-effecting tools remain untriaged.** Absence of a declaration currently means "ordinary", which is a real claim nobody has actually checked for most of the surface. Phase 1 classifies the set that can be defended tool-by-tool; it does not sweep everything.

Filed as **BI-B54D5B65**. The end state is a triage where every side-effecting tool has been consciously classified and the test asserts *completeness* rather than a pinned subset — at which point a new tool cannot ship without someone deciding what it can undo.

Also out of scope: joining this to the evidence work (BI-8192557E). A consequential call clears an alignment gate today; it does not have to cite re-verifiable evidence for its own justification. That is a genuine next step, and `requireEvidence` still has no production callers (**BI-D045A069**).

## 5. Verification

- Unit: `pnpm --filter web exec vitest run lib/tak/ lib/mcp/ lib/mcp-governed-execute.test.ts` — 2,215 tests / 214 files.
- Production build: `pnpm --filter web build`.
- No migration. No UI surface, so no UX verification path.
