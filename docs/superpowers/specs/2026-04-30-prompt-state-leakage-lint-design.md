# Prompt State-Leakage Lint Design

| Field | Value |
| - | - |
| Status | Draft |
| Date | 2026-04-30 |
| Scope | A small CI gate that prevents persona prompts from documenting runtime state, especially tool grants, capability flags, and "currently empty/pending" status claims. This is the bug class that caused the BI-E9CD1B92 lifecycle test to fail on 2026-04-30. |
| Pattern precedent | [Coworker Personas Audit](2026-04-27-coworker-persona-audit-design.md), [Coworker Tool-Grant Audit](../audits/2026-04-27-coworker-tool-grant-audit.md) |
| Cross-references | [Build Specialist Operator Contract section 9 follow-up](2026-04-30-build-specialist-operator-contract.md), wave-1 AI Coworker Operator Pattern currently in the `coworker-marketing-recovery` worktree |

## 1. Problem

On 2026-04-30, the build-specialist coworker (`AGT-WS-BUILD`, model `claude-haiku-4-5`) ran three iterations of the agentic loop with zero tool calls even though the runtime delivered callable tools. The agent's text response followed stale future-state wording in [`prompts/route-persona/build-specialist.prompt.md`](../../../prompts/route-persona/build-specialist.prompt.md):

> "currently `[]` (empty), pending follow-on assignment"

The agent was behaving rationally: the system prompt told it that its grants were not live yet. The system prompt was wrong. Runtime grant delivery had moved on, but the prompt still carried an old sequencing-plan snapshot.

Current repo evidence from 2026-04-30:

- Eight route-persona prompts contain the exact stale per-agent-grant future-state paragraph: `admin-assistant`, `build-specialist`, `customer-advisor`, `ea-architect`, `hr-specialist`, `ops-coordinator`, `platform-engineer`, and `portfolio-advisor`.
- Many additional orchestrator/specialist prompts contain `currently aspirational` grant annotations. Those may be true capability gaps from the 2026-04-28 self-assessment and should not be swept into this first gate without a separate source-of-truth review.
- The existing persona audit already warns when a `# Tools Available` list drifts from `packages/db/data/agent_registry.json`; this lint focuses on prompt text that tells the model to distrust live runtime capability.

Single-line summary: prompts that enumerate runtime state will rot, and rotted prompts can override the runtime in the model's reasoning.

## 2. Principle

Prompts describe behavior, not mutable state.

The prompt may define role, accountability, judgment, route behavior, escalation rules, and workflow recipes. Runtime state belongs to the runtime. That includes delivered tools, effective grant intersections, model bindings, enabled MCP servers, user capability filters, current backlog status, capability flags, and "this is pending" claims.

For tool availability specifically:

- `packages/db/data/agent_registry.json` is the static registry source for an agent's intended `config_profile.tool_grants`.
- `packages/db/data/grant_catalog.json` is the static catalog source for grant semantics.
- `apps/web/lib/mcp-tools.ts#getAvailableTools` is the runtime delivery path that intersects user permissions, mode, external-access settings, MCP availability, and agent grants.
- `packages/db/src/seed.ts` is bootstrap history, not prompt-authoring truth. It can be cited only as a migration/setup pointer, not as evidence that a prompt should tell an agent what it currently has.

The lint enforces this principle mechanically so reviewers do not need to catch every recurrence by hand.

## 3. Research & Benchmarking

Open-source / standards-shaped references:

- [ESLint custom rules](https://eslint.org/docs/latest/extend/custom-rules) show the useful shape for a local lint rule: explicit rule metadata, precise problem reports, and testable matching logic. We adopt the "one finding per concrete violation" reporting style, but we do not use ESLint because these are markdown prompt files and the repo already has TypeScript audit scripts.
- [Semgrep CE in CI](https://semgrep.dev/docs/deployment/oss-deployment) and [Semgrep CI baseline scanning](https://semgrep.dev/docs/deployment/add-semgrep-to-ci) validate the pattern of simple rules plus PR-time enforcement. We reject adding Semgrep for this slice because AGENTS.md requires the Tool Evaluation Pipeline before adopting external tooling, and the existing repo audit harness is enough.
- [pre-commit](https://pre-commit.com/) validates a local fast-feedback hook pattern. We defer local hook integration because CI is the first enforcement surface and the existing DPF hook is already tuned around TypeScript typecheck.

Commercial / hosted gate references:

- [GitHub code scanning pull-request alerts](https://docs.github.com/code-security/code-scanning/managing-code-scanning-alerts/triaging-code-scanning-alerts-in-pull-requests) demonstrates the reviewer-facing expectation: findings must be visible on the PR and tied to exact locations.
- [SonarQube quality gates](https://docs.sonarsource.com/sonarqube/latest/user-guide/quality-gates) reinforce that a gate should fail on policy conditions rather than rely on manual review memory.
- Semgrep's managed policy model, including PR blocking behavior, supports the same operational pattern, but DPF should keep this as a repo-owned audit until the tool-evaluation process approves anything external.

Patterns adopted: exact file/line findings, PR artifact upload, fail-on-new findings, and a governed baseline. Patterns rejected: adopting a new scanner for a single markdown rule family, and letting the baseline grow silently.

## 4. Goals

1. Block any new occurrence of stale runtime-state language in prompt files.
2. Track existing violations explicitly through a committed baseline.
3. Enforce shrink-only baseline updates so a PR cannot hide a new violation by adding it to the baseline.
4. Reuse the existing TypeScript audit-script and GitHub workflow shape from `audit-coworker-personas.ts`.
5. Produce machine-readable JSON plus readable CI output that names file, line, rule, phrase, and remediation.

## 5. Non-goals

- Rewriting the currently violating prompts. That work is sequenced through wave-2 and wave-4 prompt rewrites.
- Settling whether every `currently aspirational` annotation is true. Those lines describe a broader grant-honoring gap and need the tool-grant audit/self-assessment context before they can be safely banned.
- Replacing the coworker-personas audit or tool-grant audit. This lint complements both.
- Reading the live database. This is a static PR-time prompt-library lint, not a runtime grant-delivery verifier.
- Blocking prompts from citing canonical files. The issue is stale state claims, not source links.

## 6. Lint Rules

The script scans `prompts/route-persona/**/*.prompt.md` and `prompts/specialist/**/*.prompt.md`. It should ignore generated reports and docs.

### PSL-001: stale future-state grant phrases

Flag these case-insensitive regex patterns anywhere in prompt bodies:

| Pattern | Why |
| - | - |
| `currently\s+\[\]` | Exact failure mode: claims grants are empty when runtime may deliver tools. |
| `pending follow-on assignment` | Defers state to a future PR without checking whether that PR has shipped. |
| `once the per-agent grant` | Specific stale sequencing-plan language from the failed build-specialist case. |
| `will hold a curated set` | Future-state grant framing that the model can treat as not-yet-true. |
| `tools? the role expects to hold once granted` | Tells the model the listed tools are expected later, not usable now. |

### PSL-002: unsourced grant enumeration

A `# Tools Available` or `# Tool Use` section that lists grant-like bullets must cite the static grant source in the section body:

- Required: `packages/db/data/agent_registry.json` for the agent's intended grants.
- Recommended when explaining grant meanings: `packages/db/data/grant_catalog.json`.

Do not accept `packages/db/src/seed.ts` as the sole citation. Seed code may mirror registry bootstrap defaults, but prompts should not make live/current claims from it.

The rule should only flag sections with grant-like bullets, using a conservative pattern such as:

```text
^\s*[-*]\s+`?[a-z][a-z0-9_]*(?:_(?:read|write|create|execute|publish|emit|validate|provision|trigger|promote|triage))`?\b
```

### PSL-003: current-state grant counts and snapshots

Flag literal grant snapshots in prompt prose when they are framed as current runtime state:

- `currently ["..."]`
- `currently \`["..."]\``
- `currently holds?`
- `you currently have`
- `grants you currently hold`

Exception: a line may use this language only when it explicitly says the PAGE DATA / runtime tool list is authoritative and the file path is a non-authoritative reference. Prefer avoiding the phrase entirely.

### PSL-004: no runtime-disabling instruction

Flag prompt language that instructs the model not to use tools because they are pending, aspirational, unhonored, or unavailable unless the sentence points to an active runtime evidence source. This rule starts as warn-only because many specialist prompts intentionally document unhonored grants from the coworker self-assessment. Promote to error after a separate review of those prompts.

## 7. Architecture

### 7.1 Script

Create `apps/web/scripts/audit-prompt-state-leakage.ts`.

The script should mirror the existing audit scripts:

- resolve repo root through `pnpm-workspace.yaml`
- read prompt files recursively under `prompts/route-persona` and `prompts/specialist`
- parse lines without a markdown dependency for v1
- emit a stable JSON report to stdout
- support `--baseline <path>`
- support `--json-out <path>`
- support `--help`

Finding shape:

```ts
interface Finding {
  invariantId: "PSL-001" | "PSL-002" | "PSL-003" | "PSL-004";
  severity: "error" | "warn";
  file: string;
  line: number;
  column: number;
  match: string;
  summary: string;
  detail: string;
}
```

Finding identity for baseline comparison must be stable across unrelated line movement:

```ts
function findingKey(f: Finding): string {
  return `${f.invariantId}::${f.file}::${normalizeMatch(f.match)}`;
}
```

Do not include line number in the key. Line number is display evidence only.

### 7.2 Baseline

Create `docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json`.

The initial baseline is generated once against the current tree. It lists known violations that are already scheduled for wave prompt rewrites.

Baseline policy:

- New findings compared with the committed baseline fail the job.
- Resolved findings are printed as "can be removed from baseline".
- Baseline updates may only remove keys. They may not add keys in a PR.
- When the baseline reaches zero findings, keep the file as an empty tombstone unless maintainers choose to delete it in a dedicated cleanup PR.

### 7.3 Shrink-only baseline guard

The workflow must protect against baseline laundering.

On pull requests, after checkout with enough history to read the base branch:

1. Run the audit against the current tree and current baseline.
2. If the baseline file changed in the PR, read the base branch copy of the baseline.
3. Fail if the PR baseline contains any finding key that was not present in the base baseline.
4. Allow removals only.

This can live in the TypeScript script as `--baseline-may-only-shrink-from <path>`, or as a small Node/PowerShell helper in the workflow. Prefer implementing it in the TypeScript script so local verification matches CI.

### 7.4 Workflow

Create `.github/workflows/audit-prompt-state-leakage.yml`, modeled on `.github/workflows/audit-coworker-personas.yml`.

Triggers:

- `pull_request` to `main` when any of these paths change:
  - `prompts/**/*.prompt.md`
  - `apps/web/scripts/audit-prompt-state-leakage.ts`
  - `docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json`
  - `.github/workflows/audit-prompt-state-leakage.yml`
- `push` to `main` as a defensive post-merge signal.

Use `pnpm --filter web exec tsx`, matching the existing workflow's workspace name.

The workflow should upload `audit-current.json` as an artifact and print stderr summaries for humans.

### 7.5 Pre-commit

Deferred. A later slice can extend `.githooks/pre-commit` to run the audit on staged prompt files, but the first PR should stay CI-only.

## 8. Implementation Notes

- Keep matching conservative. It is better to block the exact stale-state bug class than to create noise across every legitimate "aspirational capability" note.
- Keep rule definitions inside the script as named constants for v1. Move to JSON only if operators need to tune phrases without code changes.
- Normalize path separators to forward slashes in output.
- Preserve CRLF/LF handling by splitting on `/\r?\n/`.
- Treat markdown links as source citations only when the URL target contains the canonical repo path.
- Do not import new runtime dependencies.
- Use `pnpm --filter web exec tsx`; do not use `npx`.

## 9. Acceptance

- Adding `currently []`, `pending follow-on assignment`, or `tools the role expects to hold once granted` to a prompt fails CI with an error-level finding.
- A `# Tools Available` section with grant-like bullets fails when it omits `packages/db/data/agent_registry.json`; sections that explain grant meanings are expected to cite `packages/db/data/grant_catalog.json` as a follow-up quality target.
- A prompt rewrite that removes baseline findings passes when the baseline is regenerated and committed with fewer keys.
- A PR that adds a new violation and expands the baseline fails the shrink-only baseline guard.
- The initial lint PR passes with existing violations grandfathered.
- The JSON report is stable enough for review: sorted findings, normalized paths, and line numbers for display.

## 10. Verification Plan

Run these checks for the implementation PR:

1. `pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts --help`
2. `pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts --baseline docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json > audit-current.json`
3. Add a temporary forbidden phrase to a scratch prompt file and confirm the script exits non-zero. Revert the scratch change before commit.
4. Add a temporary new key to the baseline and confirm the shrink-only guard exits non-zero. Revert before commit.
5. `pnpm --filter web typecheck`

No production build is required for a script-only audit unless the PR also changes runtime code or prompt-loader behavior.

## 11. Open Follow-up

- Add local pre-commit integration after CI has proven low-noise.
- Design a separate stale model-ID lint for retired model identifiers.
- Review the broader `currently aspirational` prompt family against the coworker self-assessment and tool-grant audit before promoting PSL-004 to error.
- Add an AGENTS.md pointer after the canonical operator-pattern artifact lands on main.

## 12. Why this is not bundled into wave 2

The lint is independent of the wave-1 canonical-pattern dependency that gates the build-specialist prompt rewrite. It can ship as its own small PR, and the build-specialist rewrite can then rely on the lint to prevent regression.
