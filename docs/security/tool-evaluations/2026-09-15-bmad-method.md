# BMAD Method tool evaluation

**Date:** 2026-09-15
**Subject:** BMAD Method (`bmad-method` v6.12.0, MIT, <https://docs.bmad-method.org>, <https://github.com/bmad-code-org/BMAD-METHOD>)
**Backlog:** not filed — the DPF MCP plane was unreachable from this session (`ConnectionRefused` on `/api/mcp/v1`), so no `create_backlog_item` call was made. The follow-up items in "What DPF should harvest" still need filing.
**Decision:** **REJECT as an installed dependency. ADOPT as a standing §7 benchmark, and harvest three specific ideas as backlog items.**
**Risk level of the rejected path:** medium (governance and single-source-of-truth erosion, not security)
**Confidence:** high on the architecture verdict; medium on the harvest list, which is a reading of BMAD's docs rather than a hands-on trial.

## Executive decision

BMAD is a good framework aimed at a problem DPF has already solved differently and, on the axes that matter to this platform, further. It is a **file-based, decentralised** delivery method for a single developer driving one or two AI coding CLIs. DPF is a **server-side governed platform** whose delivery pipeline is itself a product surface, with a database coordination plane, typed gates, 87 registered coworkers and capability intersection. Installing BMAD would not add a missing capability; it would add a second, weaker, ungoverned home for state DPF already owns — the exact failure mode `single-source-of-truth` and `mcp-is-the-coordination-plane` exist to prevent.

The evaluation is therefore not "is BMAD good?" (it is) but "does it fit here?" (it does not, as code). Its genuine value to DPF is as a **benchmark and an idea source**: it is the largest open-source project in DPF's own category (~53k GitHub stars, 514 npm releases, last publish 2026-09-05), and AGENTS.md §7 requires every new feature spec to compare against open-source leaders. BMAD is that leader for the delivery-process specs.

## What BMAD is

A method distributed as files — agent personas, workflow skills and templates — plus a CLI installer that drops them into an AI coding tool.

| Dimension | BMAD v6 |
|---|---|
| Install | `npx bmad-method install`, project-level; writes `_bmad/` plus skills into each selected tool's directory. Also `npx skills add bmad-code-org/BMAD-METHOD` and the Claude Code / Codex plugin marketplaces. |
| Surfaces | Claude Code, Cursor, Codex (`--list-tools` for the current set). Web Bundles for Gemini Gems and ChatGPT Custom GPTs. |
| Modules | BMad Method (BMM, core delivery), BMad Builder (author agents/skills), Creative Intelligence Suite, Test Architect, BMad Loop, Game Dev Studio. |
| Agents | Five named BMM personas: Analyst (Mary), PM (John), Architect (Winston), Developer (Amelia), UX Designer (Sally). |
| Core skills | `bmad-help`, `bmad-advanced-elicitation`, `bmad-review`, `bmad-customize`, `bmad-brainstorming`, `bmad-deep-recon`, `bmad-forge-idea`, `bmad-party-mode`. |
| Workflow skills | `bmad-product-brief`, `bmad-prfaq`, `bmad-prd`, `bmad-spec`, `bmad-ux`, `bmad-architecture`, `bmad-create-epics-and-stories`, `bmad-sprint-planning`, `bmad-correct-course`, `bmad-project-context`, `bmad-build`, `bmad-build-auto`, `bmad-code-review`, `bmad-walkthrough`, `bmad-qa-generate-e2e-tests`, `bmad-retrospective`. |
| Lifecycle | clarify → plan → build and verify → learn and adjust. |
| Scale adaptation | Four paths: trivial / one-session / epic-sized / project-sized. |
| State | Files only. `SPEC.md`, `stories.yaml`, `stories/*.md`, `_bmad/custom/*.toml` committed to git; `.user.toml` gitignored. The team page is explicit: no server, no database, no coordination plane. |
| Licence | MIT. Trademark held by BMad Code, LLC. |

## Where DPF already stands

Every structural idea in BMAD has a live counterpart here, in almost every case with a stronger enforcement story.

| BMAD | DPF equivalent | Assessment |
|---|---|---|
| Four planning paths, sized by intent | `(type × size)` `LifecyclePolicy` matrix (`apps/web/lib/explore/build-process-matrix.ts`, `feature-build-types.ts`), `BacklogItem.effortSize`, `docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md` | DPF stronger — the phase graph never changes; skipped phases take an auto-pass gate, so right-sizing cannot silently drop an evidence requirement. |
| clarify → plan → build → learn | ideate → plan → build → review → ship, each advanced by `checkPhaseGate` against typed evidence columns on `FeatureBuild` | DPF stronger — gates read evidence records, not prose. |
| Five named personas | 87 agents in `packages/db/data/agent_registry.json`, each with `hitl_tier_default`, `human_supervisor_id`, `delegates_to`/`escalates_to`, `tool_grants` intersected with the user's capabilities at runtime | DPF stronger — BMAD personas are prompt framing; DPF coworkers are an authorization model. |
| `SPEC.md` + `stories.yaml` | `Epic` / `BacklogItem` / `FeatureBuild` / `Workroom` in Postgres, reached through MCP | Different in kind. See "The decisive conflict". |
| `_bmad/custom/*.toml` layered overrides | `agent_registry.json` + `AgentToolGrant` + runtime intersection, single-source per AGENTS.md §6 | DPF stronger and deliberately less flexible — per-surface re-derivation is a defect here. |
| Theory of project context (lean `AGENTS.md`) | `AGENTS.md` + tiered kernel principles under `docs/founder-kernel/wiki/principles/`, retrieved by `wiki_query` | **BMAD arguably stronger.** See harvest item 1. |
| `bmad-build-auto` unattended loop | Workroom autonomy, `2026-07-12-graduated-gate-autonomy-design.md`, `2026-07-26-evidence-earned-autonomy-design.md`, `2026-06-28-regulatory-autonomy-ceiling-policy-design.md` | DPF stronger — autonomy is earned against recorded evidence, not a flag. |
| `bmad-brainstorming`, `bmad-deep-recon`, `bmad-review` | `dpf-brainstorming`, `dpf-compare-options`, `dpf-decision-via-kernel`, `dpf-architecture-review` (69 skills in `packages/dpf-skill-pack/skills/`) | Parity. |
| `bmad-correct-course` (mid-sprint change) | No direct equivalent found | **Possible gap.** See harvest item 2. |
| `bmad-retrospective` (epic completion) | `InitiativeGateKey.post-implementation-review` | Parity in substrate; BMAD's facilitation framing is an input. |
| Review loop halts after 5 non-converging iterations | `GATE_SHAPING_DEFAULT = { maxAttempts: 5, maxOptions: 5 }` (`apps/web/lib/work-management/gate-shaping.ts:141`) | Independent convergence on the same number. Worth citing as external corroboration in the gate-shaping spec. |

## The decisive conflict

Four reasons the code cannot come in, in descending order of force.

**1. BMAD has no coordination plane; DPF's is binding doctrine.** BMAD's team guidance states plainly that shared state is committed files under `_bmad/`. DPF's `2026-06-05-unified-delivery-surfaces-execution-alignment-design.md` states the opposite invariant: *if it isn't in the MCP plane, it didn't happen*. A repo carrying both `stories.yaml` and `BacklogItem` rows has two answers to "what is the next story and what is its status", and no mechanism decides between them. This is a direct AGENTS.md §1 single-source-of-truth violation, and it is not fixable by convention — it is what the framework *is*.

**2. It would break surface parity.** AGENTS.md §12 fixes four/five peer surfaces on one process: Claude Code, Codex CLI, Grok, Antigravity, Build Studio. BMAD reaches the CLI surfaces and does not reach Build Studio or in-portal coworkers. Installing it means the process a contributor follows in Claude Code differs from the one a customer's coworker follows in the portal — a two-process platform, which is precisely what "Build Studio for all development" was retired to avoid. It also collides with the §1 commandment that platform function never depends on a client: BMAD's guarantees live entirely in a client's skill directory.

**3. Its evidence contract is strictly weaker, and §4 forbids weakening.** `bmad-build-auto` records a prose summary, findings breakdown, `baseline_revision` and a `status: blocked` reason into a spec file. DPF gates require typed evidence records, a `gateKey = sha256(repository + integrationTreeSha + evidencePlanDigest + toolchainFingerprint + gateKind)` for single-flight identity, and a refusal classification (`shape` / `escalate` / `hard-no`) held in a closed `Record` that **fails to compile** if a denial reason is added without classifying it. A prose halt reason cannot feed those gates, and routing DPF work through BMAD's loop would replace a machine-checked contract with a readable one.

**4. Installation mechanics conflict with standing rules.** The documented install is `npx bmad-method install`, and AGENTS.md §2 forbids `npx` outright (it ignores pinned versions; use `pnpm --filter <pkg> exec`). The install is project-level by default, whereas AGENTS.md §11 requires non-DPF packs to go in local/user scope only, for a documented gap, and never to be seeded for in-portal coworkers. And §11's precedence rule — a session with non-DPF process skills visible and no DPF replacement is DPF-precedence-unproven — means 24 project-scoped `bmad-*` skills sitting beside 69 `dpf-*` skills would leave every session's precedence ambiguous.

None of these is a security objection. The security profile is unremarkable and is recorded below for completeness, because the pipeline requires a finding per category.

## Security findings (CoSAI)

Scope of assessment: the `bmad-method` npm installer and the files it writes. BMAD executes as prompt/skill content inside an AI client; it is not a service and holds no credentials of its own.

| # | Category | Severity | Finding | Mitigatable? |
|---|---|---|---|---|
| 1 | Authentication | none | No auth surface. The installer does not authenticate and stores no credentials. | n/a |
| 2 | Access control | **medium** | BMAD skills inherit whatever tool permissions the host client grants; the framework has no permission model of its own. In DPF terms, it cannot participate in grant intersection — a §6 misfit rather than a vulnerability. | Only by not adopting. |
| 3 | Input validation | low | Installer parses YAML/TOML/XML/CSV (`js-yaml`, `yaml`, `xml2js`, `csv-parse`) from repo-local files. `xml2js` is the weakest link but operates on trusted local input. | Yes (pin, review). |
| 4 | Data/control boundary | **medium** | Skill and override files are executable instructions to an agent. A malicious or careless `_bmad/custom/*.toml` in a pulled branch changes agent behaviour with no review gate distinct from ordinary code review. Generic to all skill packs, DPF's own included. | Partially — PR review only. |
| 5 | Data protection | low | Everything stays local; no telemetry or network egress documented in the installer path. Web Bundles (Gemini/ChatGPT) would export context to third parties, but that is an opt-in separate surface DPF would not use. | Yes (do not use Web Bundles). |
| 6 | Integrity controls | low | npm dist integrity only; no signing or provenance attestation observed. Three npm maintainers (`bmadcode`, `muratkeremozcan`, `alex_verk`). | Yes (lockfile pin). |
| 7 | Session/transport | none | No runtime transport. | n/a |
| 8 | Network isolation | none | No listeners, no ports, no containers. | n/a |
| 9 | Trust boundary | **medium** | Gates are LLM judgement expressed in prose, with the human as the only hard stop ("You make the calls"). Sound for an individual developer; below DPF's bar, where a gate must be machine-evaluable and a refusal typed. | Only by not adopting. |
| 10 | Resource management | low | The autonomous loop is bounded (5 review iterations, then `status: blocked`) but has no token or wall-clock budget. Relevant to AGENTS.md §1 responsible capacity utilisation. | Yes (operator supervision). |
| 11 | Operational security | low | Evidence is prose in spec files. No structured audit trail, no DPF action receipts. | Only by not adopting. |
| 12 | Supply chain | low | 13 direct dependencies, all mainstream and non-exotic (`glob`, `yaml`, `chalk`, `ignore`, `semver`, `xml2js`, `js-yaml`, `commander`, `csv-parse`, `picocolors`, `@clack/core`, `@clack/prompts`, `@kayvan/markdown-tree-parser`). Actively maintained: 514 versions, latest 6.12.0, published 2026-09-05. No abandonment signal. No CVE ≥ 9.0 identified. `npx` install violates §2. | Yes, if it were adopted. |

No early-termination condition was hit: licence is compatible, the project is actively maintained, there are no hardcoded credentials and no critical CVE.

## Compliance

- **Licence:** MIT — compatible. "BMad" is a trademark of BMad Code, LLC, so any harvested idea must be reimplemented and attributed by citation, never by copying skill text or persona names into `packages/dpf-skill-pack/`.
- **Data residency:** the installer and skills are local-only. Web Bundles would move context to Gemini/ChatGPT; out of scope and not recommended.
- **Regulatory:** no EU AI Act implication beyond what DPF already carries. BMAD is prompt content, not a model or a deployed AI system.
- **IP:** citing BMAD as a benchmark in a spec's Research & Benchmarking section is the intended and safe use.

## Architecture fit

Poor as code, good as a reference. BMAD assumes the developer is the coordination plane and the repository is the database. DPF assumes a governed server owns work identity, authority and evidence, and that the client is interchangeable. Those are not two implementations of one design; they are opposite answers to where truth lives. Everything BMAD would contribute in structure, DPF has — usually enforced at the type or schema level rather than by prompt.

## Integration test

**Not run, deliberately.** Phase 5 exists to de-risk adoption, and the architecture verdict at Phase 4 is reject-as-dependency. Running `npx bmad-method install` in this tree would write `_bmad/` and project-scoped skill directories into the repo, violating §2 (`npx`) and §11 (project-scoped non-DPF pack) to test a path we are not taking. If the founder overrides the verdict, the trial belongs in a throwaway worktree with `--modules bmm --tools claude-code`, never in a tree that can be pushed.

## What DPF should harvest

Three ideas, with the honest caveat that each needs its own backlog item and shaping before it is more than a suggestion. None requires installing anything.

**1. BMAD's theory of project context, applied as an audit of DPF's own `AGENTS.md`.** BMAD's stringency test is sharper than ours: a line belongs not if an agent *could* fail to derive the fact, but by what it costs every time one doesn't. They cite measurements — bloated docs cost ~20% more inference with no success gain, while a compressed purpose-built index took success from 53% to 100% — and they run two named processes over the file: **refresh** (re-check every statement against current reality) and **audit** (does this line still change agent behaviour?), with the rule that a working rule stays even without recent failures. DPF's `AGENTS.md` front-loads deliberately (`DI-F844365B0DCC` Option B) and the kernel already holds `commons-are-curated-not-just-appended`, so the principle is present; the *cadence and the behaviour-change test* are not, and the front-loading decision was made without this evidence on the table. Proposed: a periodic refresh/audit sweep over `AGENTS.md` and the kernel principles, and a revisit of the front-loading decision citing BMAD's numbers.

**2. `bmad-correct-course` — mid-work change assessment.** DPF handles a gate *refusing* work (reshape/escalate/hard-no) and a build being *abandoned* (`abandon_stalled_build`), but no substrate was found for the common middle case: the requirement changed while the build is in `build` phase, and someone must decide whether to re-plan, re-scope or split. Today that likely resolves as an ad-hoc conversation, which means it leaves no evidence. Proposed: confirm the gap against `2026-06-27-work-management-architecture-design.md` and the convergence memo before filing — if it is genuinely absent, a `dpf-correct-course` skill plus a phase-regression evidence record is the shape.

**3. BMAD as a standing named benchmark for §7.** AGENTS.md §7 requires every new feature spec to compare 2–3 open-source leaders. For any spec touching the delivery lifecycle, agent personas, spec authoring or autonomous build loops, BMAD is the leader to compare against, and no DPF spec currently cites it. Proposed: name BMAD in the design-research runbook's worked examples as the default comparator for delivery-process specs.

One smaller note, not worth an item: BMAD's autonomous loop halts after 5 non-converging review iterations, and DPF's `GATE_SHAPING_DEFAULT` independently landed on `maxAttempts: 5`. That convergence is usable external corroboration when the gate-shaping ceiling is next questioned.

## Conditions and re-evaluation

Conditions on the adopted path (benchmark + harvest):

- No `bmad-method` install in any tree that can be pushed. No `_bmad/` directory in this repository.
- No `bmad-*` skills seeded for in-portal coworkers, under any circumstance (§11).
- Harvested ideas are reimplemented from first principles under `dpf-*` naming, with BMAD cited as prior art. No skill text, persona names or trademark usage copied.
- A contributor who wants to try BMAD personally installs it in local/user scope only, for a documented gap, per §11.

Re-evaluation: **2027-03-15**, or earlier on any of these triggers:

- BMAD ships a server-side or API-addressable coordination plane (this would remove conflict 1 and make a genuine integration conceivable).
- DPF adds a delivery surface BMAD already covers well and DPF does not.
- A harvest item above is filed and shaped, at which point the relevant BMAD workflow should be read in detail rather than from its docs summary.

## Sources

- <https://docs.bmad-method.org> — homepage, four-phase loop
- <https://docs.bmad-method.org/reference/skills-and-agents/> — skill and agent inventory
- <https://docs.bmad-method.org/plan/choose-a-planning-path/> — four planning paths and artifacts
- <https://docs.bmad-method.org/existing-codebases/theory-of-project-context/> — project-context theory and the cited measurements
- <https://docs.bmad-method.org/build/autonomous-development-loops/> — `bmad-build-auto` gates, halts and evidence
- <https://docs.bmad-method.org/customize/adopt-bmad-across-a-team/> — team model, `_bmad/custom/`, no coordination plane
- <https://docs.bmad-method.org/start/install-bmad/> — install commands and layout
- <https://github.com/bmad-code-org/BMAD-METHOD> — modules, install routes, licence
- `https://registry.npmjs.org/bmad-method` — v6.12.0, MIT, dependency list, 514 versions, published 2026-09-05
