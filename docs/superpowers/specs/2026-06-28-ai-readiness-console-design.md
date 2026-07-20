---
title: AI Readiness Console - automate provider, build engine, MCP, and routing setup
authoredAt: 2026-06-28
authoredBy: Codex
status: design
specKind: design
relatedFiles:
  - apps/web/app/(shell)/platform/ai/runtime-health/page.tsx
  - apps/web/lib/inference/phase-model-resolution.ts
  - apps/web/components/platform/ProviderDetailForm.tsx
  - apps/web/components/platform/ModelSection.tsx
  - apps/web/components/platform/ModelCard.tsx
  - apps/web/components/platform/EndpointPerformancePanel.tsx
  - apps/web/components/platform/BuildStudioConfigForm.tsx
  - apps/web/components/platform/ContributorMcpReadinessCard.tsx
  - apps/web/lib/integrate/build-studio-config.ts
  - apps/web/lib/mcp/contributor-readiness.ts
  - apps/web/lib/routing/provider-routing-eligibility.ts
  - packages/db/prisma/schema.prisma
relatedSpecs:
  - docs/superpowers/specs/2026-04-08-build-studio-config-design.md
  - docs/superpowers/specs/2026-05-26-contributor-client-mcp-readiness-design.md
  - docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md
  - docs/superpowers/specs/2026-06-19-provider-model-scoring-convergence-design.md
  - docs/superpowers/specs/2026-06-22-build-studio-model-tier-routing-design.md
---

# AI Readiness Console

## 1. Problem

The AI setup experience exposes too many substrate choices as human decisions:

- Provider detail asks humans to understand model families, save/test/discover/profile, model search, routing scores, eval counts, probes, fill tests, and tier overrides.
- Build Studio setup asks humans to pick a build dispatch engine, credential source, model preference, and MCP token state, even though most of those choices are policy consequences.
- Runtime Health explains which model or engine will run each Build Studio phase, but it is another separate page the operator must know to visit.
- Routing and model assignment pages expose model-choice machinery separately from provider setup, which makes the operator ask, "What should I do after I find a model?"
- Provider-specific constraints, like a new Z.ai provider with tool-support differences, can look like Build Studio setup when they are actually routing eligibility and model-supply facts.

The result is cognitive overload. The operator is forced to decide when to click "discover", when to run evals, when to run probes, which build engine matters, and whether "MCP readiness" is relevant. Those are system responsibilities. Human attention should be reserved for decisions the platform cannot safely automate: connect an account, approve a token, accept a cost/privacy posture, or resolve a blocked install.

## 2. Design Goal

Create one outcome-oriented **AI Readiness Console** that answers:

> Can DPF use AI safely and effectively for the work it is about to do?

The default surface should show four readiness domains:

| Domain | Human question | System-owned details |
| --- | --- | --- |
| Model supply | Do we have usable models? | Providers, credentials, discovery, profiles, metadata, pricing, capability scores |
| Build execution | Can Build Studio run work? | CLI engines, sandbox presence, provisioning, local OpenCode, legacy agentic fallback |
| Tool access | Can agents use DPF tools? | MCP tokens, grants, live probes, client binding |
| Routing confidence | Will the right model be selected? | task requirements, model profiles, tool support, phase resolution, route outcomes |

The console should show a verdict, a reason, and at most one primary action per blocking domain. If the platform can recover or refresh automatically, the domain should say "No action required" and keep the machinery in diagnostics.

## 3. Non-Goals

- Do not remove advanced provider diagnostics. Move them out of the default setup path.
- Do not rewrite routing, Build Studio dispatch, MCP auth, or provider registry in this slice.
- Do not make every model provider a Build Studio dispatch engine. Z.ai is model supply unless an approved Z.ai execution adapter exists.
- Do not silently broaden MCP authority. Token issuance and grant expansion remain governed actions.
- Do not create a second runtime-health explanation beside the existing one. Fold the existing Runtime Health read model into the console.

## 4. Current State Grounding

### 4.1 Provider detail

`ProviderDetailForm.tsx` already runs the right setup pipeline: save credentials, test auth, discover models, then profile models. `ModelSection.tsx`, `ModelCard.tsx`, and `EndpointPerformancePanel.tsx` render the deeper catalog: routing scores, evaluation counts, manual eval buttons, tier overrides, and endpoint test runs.

The problem is not missing capability. It is that the default page asks humans to interpret implementation machinery. Model search, routing score expansion, "Run Eval", "Override Tier", probes, and fill tests are useful diagnostics, but they are poor primary setup controls.

### 4.2 Build Studio setup

`BuildStudioConfigForm.tsx` renders:

- `ContributorMcpReadinessCard`
- Build Dispatch Engine radios for Claude Code CLI, Codex CLI, Grok CLI, Local model (OpenCode), and Agentic Loop
- credential source cards grouped by `ModelProvider.cliEngine`
- provider-specific model preferences
- a "Save Configuration" action

`build-studio-config.ts` already auto-detects a dispatch provider from configured providers, then applies environment overrides and tier-routing overrides. This means the system has enough signal to recommend or select a default. The default UI should not make the operator choose an engine unless policy needs a human posture decision.

### 4.3 MCP readiness

`ContributorMcpReadinessCard.tsx` and `lib/mcp/contributor-readiness.ts` already derive token state, missing grants, live probe status, and recommended actions. This is the right read model. It is currently placed inside Build Studio, which makes MCP look like a Build Studio-only concept. It should become the Tool Access domain in the console and remain linked from Build Studio.

### 4.4 Runtime health

`/platform/ai/runtime-health` and `phase-model-resolution.ts` already synthesize the three otherwise-disconnected sources: Providers & Routing, Build Runtime, and local DMR serving config. This is the strongest seed for the AI Readiness Console. It predicts the provider/model/engine per Build Studio phase by reusing routing dry-runs instead of guessing.

### 4.5 Data model

The existing schema already carries most readiness facts:

- `ModelProvider`, `DiscoveredModel`, `ModelProfile`, `EndpointTaskPerformance`, `TaskEvaluation`, and `EndpointTestRun` for provider and model readiness.
- `BuildEngine` and `BuildEngineState` for build-engine presence and provisioning state.
- MCP token rows and `contributor-readiness.ts` for tool access.
- `AgentModelConfig`, `RouteDecisionLog`, routing manifests, and phase resolution for route confidence.

The first implementation should be a read model over existing tables, not a new source of truth.

## 5. Decision

Make `/platform/ai/runtime-health` the foundation of a broader `/platform/ai/readiness` console.

The console becomes the default operator entry point for AI setup. Existing pages become drilldowns:

- Providers remains "Model Supply" detail.
- Build Studio config becomes "Build Execution" policy and diagnostics.
- MCP token management remains the governed token system of record.
- Routing/model assignment remains "Routing Confidence" diagnostics and policy detail.

The system owns discovery, profiling, tests, probes, and routing refreshes. Humans see only the next decision that cannot be automated safely.

## 6. Target Information Architecture

### 6.1 Navigation

Add a top-level AI route:

- `/platform/ai/readiness` - default readiness console
- `/platform/ai/providers` - model supply detail
- `/platform/ai/build-studio` - build execution policy and diagnostics
- `/platform/ai/model-assignment` or existing routing views - routing policy detail
- `/platform/ai/runtime-health` - redirect or alias to the runtime section of readiness after the console ships

The `/platform/ai` section already carries eight sub-nav items (Overview, Operations Map, Capacity Continuity, Priority & Models, Prompts, Skills, Providers & Routing, Build Studio). Readiness must reduce that load, not add a ninth peer:

- Readiness becomes the section **default** - it replaces or absorbs "Overview" as the entry point (`/platform/ai` resolves to readiness), so there is one front door, not two status pages.
- It is distinct from "Operations Map" (real-time agent routing topology) and "Capacity Continuity" (capacity/failover); keep those as drilldowns and do not duplicate their content in the readiness rows.
- Providers & Routing, Priority & Models, and Build Studio become the per-domain drilldowns named above.
- `runtime-health` is a page operators must currently know the URL for - it is not in the nav today - so fold it into the Routing Confidence drilldown and alias the old link rather than promoting "Runtime Health" as a label.

This is a net surface reduction - several setup destinations behind one verdict - and respects nav-coherence: no new top-level rail, no cross-section teleports, ordered facts not a composite score (EP-NAV-COHERENCE). Operators think in whether the platform can do the work, not in runtimes.

### 6.2 Default console layout

The first viewport should be operational, not explanatory:

1. Verdict banner: `Ready`, `Needs attention`, or `Blocked`.
2. Four readiness rows: Model Supply, Build Execution, Tool Access, Routing Confidence.
3. One recommended action, only when the system cannot recover automatically.
4. Recent evidence: last provider sync, last engine probe, last MCP probe, last routing preview.
5. Diagnostics drawer or tab for raw details.

The four rows should use stable dimensions and compact status language so the page scans like an operations console, not a setup wizard.

Example states:

| Domain | Ready copy | Attention copy | Blocked copy |
| --- | --- | --- | --- |
| Model Supply | 3 providers routable, 42 models profiled | Z.ai connected; profiling in background | No routable provider |
| Build Execution | Codex CLI ready; OpenCode available | Grok missing; Codex fallback selected | Selected engine unavailable and no fallback |
| Tool Access | MCP write token active; live probe passed | Token expires soon | Missing required grants |
| Routing Confidence | Phase preview passes | New models need background eval | No tool-capable endpoint for build |

### 6.3 Blockers Reach The Operator Where They Already Are

The readiness console must not be a page the operator has to remember to visit. A `blocked` domain that needs a human action should project into the existing "Needs you" inbox (`/workspace/inbox`, EP-ATTENTION-SURFACE) as a new attention source, resolvable in place, with the console as the one-click drilldown. This is the single-inbox principle - surface what needs a person where they already look ([ServiceNow unified notifications](https://www.servicenow.com/community/employee-slate-and-employee/servicenow-employeeworks-introducing-employee-slate/ba-p/3537890); [NN/g Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).

Rules:

- Only `blocked` domains (and `attention` with a near-term deadline, e.g. a token expiring) project an attention item; `ready` and background `diagnostic` work never do - they would be noise.
- Each readiness blocker projects exactly once (single projection, no duplicate re-notify), consistent with the attention-surface discipline.
- The attention item carries the domain, the one recommended action, and a deep link to the console drilldown; resolving the blocker clears the item.
- Implementation: extend the `AttentionSource` union in `apps/web/lib/attention/types.ts` with `"ai-readiness-blocker"` plus a projector mapping `AiReadinessSummary` to `AttentionItem[]`. No new inbox.

Framing: the console is the drilldown of last resort - the verdict is a badge, the alert is in the inbox, and the machinery is hidden until asked for.

## 7. Automation Policy

The guiding principle is convention over configuration: the platform self-configures providers, engines, and routing from available signal and reports the result; the operator confirms outcomes and only touches a control to override a default ([convention over configuration](https://en.wikipedia.org/wiki/Convention_over_configuration); zero-config PaaS such as Vercel and Heroku). Readiness is an auto-detected outcome, not a setup form.

### 7.1 Provider setup

On credential save or OAuth completion, the platform should:

1. Test auth.
2. Discover models.
3. Profile newly discovered models.
4. Sync routing profiles.
5. Queue background eval/probe work when the model is a viable routing candidate.
6. Refresh the readiness summary.

Provider catalog refresh is automatic install/startup/scheduled maintenance. The default provider list shows only catalog freshness ("last updated" or "updates automatically") and never asks the operator to decide when to sync metadata. Manual refresh belongs in advanced scheduled-job recovery or AI Coworker-assisted troubleshooting.

The default button should be outcome-oriented, such as "Connect provider" or "Save and ready provider". Manual "Discover", "Profile", "Run Eval", "Run probes", and "Run fill tests" remain in diagnostics with freshness timestamps.

### 7.2 Build execution

The default policy should be automatic:

1. Prefer the configured Build Studio policy if it is still healthy.
2. Otherwise select the best ready engine from `BuildEngineState` plus configured provider credentials.
3. Prefer local or subscription-backed engines when policy allows and capability is sufficient.
4. Fall back to a robust routable provider when local/CLI execution is unavailable.
5. Surface a human action only when the selected engine is blocked and no allowed fallback exists.

The Build Dispatch Engine radio group should move behind "Advanced execution policy" or become a segmented override with clear impact copy. The default row should say what will happen, not ask the operator to pick from engine names.

The automatic policy is one capability- and policy-qualified selection, reused by `resolve_model_selection`, Ideate dispatch, and CLI-backed build dispatch. It is not a second load balancer: engine readiness and credentials narrow the provider set, then the existing `RequestContract` + `routeEndpointV2` pipeline supplies capability filtering, provider-policy fences, capacity scoring, the selected endpoint, and the ordered fallback chain.

Before routing, Build Studio excludes an engine when its registered `BuildEngineState` is absent or not present, its credential is missing/expired/auth-failed, its CLI or provider retry window is active, or its provider is currently unhealthy. The route contract then enforces sensitivity, residency, tool, context, model-class, and cost posture. Hard policy always outranks score. Local-only work cannot cross to cloud; restricted/sensitive work cannot cross to an endpoint without clearance; an explicit operator hard pin cannot fall through to another engine.

`Auto` is the default policy. A deliberate hard pin remains under Advanced execution policy for diagnostics and controlled tests. A pinned failure must name the failed engine and say that automatic fallback was disabled. In Auto mode, only a retry-safe failure before phase side effects (authentication, rate limit, or availability) may advance once to the next already-qualified engine. The retry uses the same phase idempotency guard and must not re-run a phase after evidence or source mutations begin.

Every selection records the selected engine/provider/model, routing rationale, rejected candidates with reason codes, and the ordered fallback chain. BuildActivity and the progress projection expose the same evidence. If no allowed healthy candidate remains, the phase blocks before work with one actionable explanation; operator attention is not requested while an automatic candidate remains.

### 7.3 Tool access

Tool Access should reuse `ContributorMcpReadiness`:

- Ready when a write-capable token has required grants and the live probe passes or is recently cached.
- Attention when a token is near expiry, identity binding is incomplete, or the probe has not run recently.
- Blocked when no token, an expired/revoked token, or missing grants prevent Build Studio work.

The console may offer "Test connection" as a secondary action, but it should run automatically on page load only when rate limits and security posture allow a non-mutating probe.

### 7.4 Routing confidence

Routing Confidence should be derived from the real routing pipeline:

- Use `previewRoute()` and `resolveModelSelectionByPhase()` for Build Studio phase readiness.
- Use provider routing eligibility for provider rows.
- Flag "no tool-capable endpoint" and "context too small" as blockers.
- Treat manual evals as diagnostics, not required setup work.
- Queue stale calibration work in the background instead of asking a human to decide when to run it.

### 7.5 Z.ai and future providers

Z.ai should enter through Model Supply:

- If it exposes an OpenAI-compatible chat endpoint, it is a model-routing provider.
- If it lacks tool support, the router should exclude it from tool-required build phases and still allow it for suitable non-tool tasks.
- It should not appear as a Build Dispatch Engine unless DPF adds an approved execution adapter or CLI engine for it.

This separates supply ("what models can answer?") from execution ("what process runs autonomous build work?").

### 7.6 Coordination with the Governed Adaptive Playbooks observer

The [Governed Adaptive Playbooks](2026-06-27-governed-adaptive-playbooks-design.md) observer also watches runtime evidence, including model-tier mismatch and stale calibration. The two efforts must not build parallel background-sweep machinery:

- The AI Readiness Console **owns provider/model/routing calibration queueing**: discovery, profiling, eval, probe, routing-profile sync, and stale-calibration jobs (sections 7.1, 7.4, and Phase 3). This is the single source of truth for what calibration work is queued or stale.
- The playbook observer must not run a second provider-calibration sweep. For model-tier-mismatch or stale-routing signals it composes this console's readiness summary and `provider-routing-eligibility` and emits a reviewable capability need, rather than queuing its own eval/probe jobs.
- Both use one background-job mechanism, not two schedulers; routing-confidence freshness thresholds live here, and the observer reads them.

## 8. Read Model

Add a server-side read model, initially pure TypeScript:

`apps/web/lib/ai-readiness/readiness-summary.ts`

Suggested types:

```ts
export type ReadinessState = "ready" | "attention" | "blocked" | "diagnostic";

export interface AiReadinessDomain {
  id: "model-supply" | "build-execution" | "tool-access" | "routing-confidence";
  label: string;
  state: ReadinessState;
  summary: string;
  evidence: Array<{ label: string; value: string; at?: string }>;
  blocker?: {
    code: string;
    message: string;
    primaryActionLabel: string;
    href?: string;
  };
  diagnosticsHref: string;
}

export interface AiReadinessSummary {
  state: Exclude<ReadinessState, "diagnostic">;
  summary: string;
  generatedAt: string;
  domains: AiReadinessDomain[];
}
```

State precedence:

1. Any blocked domain makes the console `blocked`.
2. Any attention domain makes the console `attention`.
3. Otherwise the console is `ready`.
4. Diagnostics never degrade readiness unless they identify a current runtime blocker.

No new database table is required for Phase 1. If later performance requires persistence, store snapshots as evidence, not as the source of truth.

## 9. UI Design Rules

- Use one row per readiness domain with icon, state, summary, evidence timestamp, and one action.
- Keep raw model IDs, eval counts, probe lists, and routing dimensions out of the default row unless they explain a blocker.
- Use disclosure for diagnostics. NN/g's progressive disclosure guidance supports showing advanced or rarely used details only when needed so users can focus on the primary task.
- Show system status continuously. NN/g's visibility-of-system-status heuristic applies directly: the console must tell the operator what is happening now, such as "profiling in background" or "MCP probe passed 3 minutes ago".
- Convey every readiness state with text + icon + color, never color alone. The Ready / Needs attention / Blocked indicators must satisfy [WCAG 2.1 SC 1.4.1 Use of Color (Level A)](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html): color is not the only visual means of conveying information. Model the status atom as `{ state, label, icon }` with color as reinforcement, reusing report-kit `StatusBadge` and DPF `--dpf-*` intents rather than raw color classes.
- Lead with one outcome verdict, not a grid of checks. A single health view scoped to one question - "can the platform run AI work?" - with drilldowns beats an everything-board; the "single pane of glass" fails when it tries to show everything at once ([Checkly](https://www.checklyhq.com/blog/broken-windows-why-the-single-pane-of-glass-is-imp/)). Keep unrelated platform telemetry out.
- Prefer recognition over recall: labels should be "Model Supply" and "Build Execution", not "ModelProfile" or "cliEngine".
- Never show two equivalent primary buttons for the same domain. If the system can choose "discover and profile", the human should not choose "discover" versus "profile".

## 10. Components

New or refactored components:

- `AiReadinessPage` - server route at `/platform/ai/readiness`.
- `AiReadinessSummaryPanel` - verdict banner and evidence.
- `ReadinessDomainRow` - compact repeated row.
- `ReadinessActionButton` - one recommended action, permission-aware.
- `RuntimePhaseDiagnostics` - extracted from the current Runtime Health table.
- `AdvancedDiagnosticsDrawer` - raw provider, eval, probe, and routing details.

Existing components to reuse:

- `ContributorMcpReadinessCard` becomes the Tool Access drilldown.
- Provider model cards remain in the Model Supply diagnostics view.
- Runtime Health phase table becomes the Routing Confidence drilldown.
- Build Studio config cards become Advanced Execution Policy.

## 11. Research and Benchmarking

### 11.1 UX standards

- [NN/g - Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports hiding advanced controls until they are relevant. This maps to moving eval/probe/tier controls behind diagnostics.
- [NN/g - Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) supports showing probe freshness, background progress, and current readiness instead of silent setup.
- [NN/g - 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) includes recognition over recall and user control. The console should name outcomes and keep expert overrides available without making them the default path.

### 11.2 Open-source benchmarks

- [GitLab Runner documentation](https://docs.gitlab.com/runner/) separates runner registration/configuration from job execution. Adopt the split between operational readiness and detailed runner configuration; reject making every runner detail a default operator choice.
- [GitHub Actions self-hosted runner documentation](https://docs.github.com/en/actions/hosting-your-own-runners) presents runner setup, status, and troubleshooting as an operational chain. Adopt explicit runner status and troubleshooting drilldown; reject requiring users to infer readiness from config rows alone.
- [Argo CD application health and sync concepts](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/) separate high-level health/sync state from detailed resource trees. Adopt the health-first summary with drilldown; reject raw-resource-first setup.

### 11.3 Commercial benchmarks

- [Vercel deployments documentation](https://vercel.com/docs/deployments) centers the deployment outcome and status, with build/runtime details available when needed. Adopt outcome-first status and evidence; reject showing build knobs as the main page.
- [CircleCI runner documentation](https://circleci.com/docs/runner-overview/) frames self-hosted runners around readiness to execute jobs. Adopt runner availability as a health signal; reject asking users to choose execution details per job when policy can decide.
- [Datadog integrations documentation](https://docs.datadoghq.com/integrations/) uses integration status, configuration, and troubleshooting as separate layers. Adopt the pattern of a concise integration health surface with deeper setup details behind it.

### 11.4 DPF patterns to preserve

- `provider-routing-eligibility.ts` already answers "can routing use this provider right now, yes/no, and why?" The console should compose that instead of inventing a second eligibility vocabulary.
- `phase-model-resolution.ts` already dry-runs real routing. The console must keep this as the routing-confidence source.
- `contributor-readiness.ts` already evaluates MCP state and recommended action. The console should move it up, not duplicate it.
- `BuildEngineState` already persists engine presence. The console should consume it and show selected fallback behavior.

### 11.5 Console, status, and onboarding precedent

- [WCAG 2.1 SC 1.4.1 Use of Color (Level A)](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html) - status must never rely on color alone; pair Ready / Needs attention / Blocked with icon + text. This is a Level-A conformance requirement, not a nicety.
- [Checkly - the single-pane-of-glass impossible triangle](https://www.checklyhq.com/blog/broken-windows-why-the-single-pane-of-glass-is-imp/) and [BETSOL - the myth of the single pane of glass](https://www.betsol.com/blog/the-myth-of-the-single-pane-of-glass/) - lead with one outcome verdict and tiered drilldowns; a view that shows everything buries the signal. Scope the console to one operator job.
- [Convention over configuration](https://en.wikipedia.org/wiki/Convention_over_configuration) and zero-config PaaS (Vercel, Heroku) - readiness is an auto-detected outcome the operator confirms, not a configuration form; only deviations need a control.
- [ServiceNow unified notifications (Employee Slate)](https://www.servicenow.com/community/employee-slate-and-employee/servicenow-employeeworks-introducing-employee-slate/ba-p/3537890) - surface and resolve blockers in the operator's existing inbox; do not rely on a console they must remember to open.

## 12. Phased Delivery

### Phase 1 - Read-only console

- Add `/platform/ai/readiness`.
- Implement `getAiReadinessSummary()` over existing read models.
- Link from providers, Build Studio, and Runtime Health.
- No mutations beyond existing actions.

### Phase 2 - Default setup simplification

- Make provider detail default to connect/save-and-ready.
- Move model family selection, model search, routing scores, evals, probes, fill tests, and tier overrides to diagnostics.
- Convert Build Studio setup into an automatic execution-policy card with advanced override.

### Phase 3 - Automation hooks

- Ensure provider save/OAuth completion queues discovery, profiling, routing-profile sync, and stale eval/probe jobs.
- Refresh readiness after each setup action.
- Add freshness thresholds so stale evidence becomes attention, not silent drift.

### Phase 4 - Navigation convergence

- Make Readiness the default AI setup entry.
- Redirect or alias `/platform/ai/runtime-health` into the Routing Confidence section.
- Keep old deep links stable.

## 13. Verification

Required tests for implementation:

- Unit tests for `getAiReadinessSummary()` state precedence and per-domain blockers.
- Unit tests proving Z.ai-style "model provider without tool support" is model supply, not a build engine.
- Component tests that default provider setup does not render manual discover/profile/eval/probe/tier controls outside diagnostics.
- Component tests that Build Studio default view renders the selected policy and one action, not five engine radios.
- Selector tests for expired credentials, mid-pre-dispatch auth failure, active retry windows, shared capacity saturation, local-only policy, hard pins, no-candidate explanations, idempotent one-hop retry, and selection/evidence parity.
- Existing `contributor-readiness` tests remain authoritative for MCP domain behavior.
- `pnpm --filter web build` for TypeScript and Next build coverage.
- UX verification on an authenticated install: visit `/platform/ai/readiness`, provider detail, Build Studio, and routing diagnostics.

## 14. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Hiding expert controls slows debugging | Keep diagnostics one click away and deep-linkable. |
| False ready state if a read model misses a blocker | Use the same source functions the runtime uses: `previewRoute()`, provider eligibility, MCP readiness, and `BuildEngineState`. |
| Automation mutates authority without consent | Discovery/profile/eval/probe may run automatically; credential connection, token authority, and policy posture remain explicit governed actions. |
| Build engine auto-selection surprises operators | Show the selected engine, reason, fallback, and diagnostics. Advanced policy can pin an engine when needed. |
| New providers are misclassified | Separate model supply from execution adapters. A provider becomes a build engine only when it has an approved engine/adapter contract. |

## 15. Acceptance Criteria

- A non-expert operator can answer "Is AI ready?" on one page without opening provider detail, Build Studio config, MCP token management, and Runtime Health separately.
- The default UI contains no manual "Discover", "Profile", "Run Eval", "Run probes", "Run fill tests", or tier override decisions.
- Build Studio setup no longer requires selecting between Claude/Codex/Grok/OpenCode/Agentic unless the operator opens Advanced Execution Policy.
- Z.ai and similar providers appear as model supply and routing candidates, not as build dispatch engines.
- Every blocker has exactly one recommended action, and every non-blocking background task shows status or freshness.
- A blocked readiness domain also appears in the operator's "Needs you" inbox (`/workspace/inbox`) with its one action and a deep link to the console - the operator is not required to remember to open the console.
- Every readiness state is conveyed by text and icon, not color alone (WCAG 1.4.1).
