---
status: draft
---

# Hermes portable-profile adapter: import and enforcement fit

**Backlog:** BI-FEA232AF · **Epic:** EP-B932453F · **Workroom:** WC-D80DF71B

**Delivery:** delivery-medium@1.0.0; independently admitted design only.

**Source inspected:** `97ecc0c1032c737da6b399c4db78e9792e4f0018`, 21 October 2026 UTC.

This design defines how a future Hermes adapter can inspect a portable reference
package, describe a Hermes projection, and report whether the selected work's
mandatory controls can be preserved. It does not install or run Hermes. No Hermes
build, operating profile, model, host, account or executing surface is selected.

The first useful result is an attributable import and loss report. A successful
content mapping cannot admit a consequential action. Missing evidence holds the
affected activity; a demonstrated incompatibility produces a bounded
incompatibility result rather than a conformance claim.

The native claim admitted DESIGN with no unmet requirements at
`2026-10-21T07:04:55.673Z` (`IRD-085B1466BC92`). That decision does not admit PLAN,
implementation, installation, runtime probes, publication or qualification.
Funding allocation is unresolved; this document makes no budget decision.

## Existing owners and dependency boundary

| Owner | Reuse here | Boundary retained |
|---|---|---|
| BI-07A2B207, [package assembly and inspection design](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/2067baab3c199119cd2108f5fe3169c8193a6310/docs/superpowers/specs/2026-10-21-portable-reference-package-design.md) | Its immutable inventory, provenance, dependency/license closure, bounded offline inspection and separate activation contract. | The inspected revision is `2067baab3c199119cd2108f5fe3169c8193a6310`. Package implementation and completed plan, coverage and applicable admission evidence remain separate prerequisites; this adapter does not fork or implement them. |
| BI-F9582C48, [portable contract design](2026-09-27-portable-tak-contracts-design.md) and [consumer contract](../../architecture/trusted-agent-reference-contract.md) | `importTrustedArtifact`, exact extension negotiation, five versioned artifacts and the pure reference loop in `packages/validators/src/`. | Artifact version `0.1.0` is distinct from package inventory `1.0.0` and any Hermes version. Schema success supplies no authority or durable execution. |
| [TAK](../../architecture/trusted-ai-kernel.md), [GAID](../../architecture/GAID.md), [TAK-JSI](../../architecture/job-specific-intelligence.md), [GPP](../../architecture/gated-permissions-process.md) | Current actor and owning-scope authority, composition/qualification attribution, exact-effect mediation and separately versioned GPP bindings. | No new permission model, qualification scheme, binding registry or receipt ledger. |
| BI-2AB781FA; BI-F3C2EC7A | Family assessment denominator and canonical DPF specimen respectively. | This document freezes neither. Hermes results cannot substitute for either owner's evidence. |
| BI-0E56BA38 | Cursor reproduction owns its separate projection and target evidence. | No changes to the Cursor design or workspace, and no inherited target equivalence. |
| [Governed Hermes-style learning loop](2026-05-15-governed-hermes-learning-loop-design.md) | Its separation of reviewed learning proposals from live authority and shared-state mutation. | That design concerns DPF learning infrastructure, not an implemented Hermes import adapter. No learning, memory or scheduler substrate is added here. |

The committed source-code graph query for `hermes` returned the learning-loop
design and its architecture assessment, not a Hermes portability implementation.
This bounded search is evidence for reuse planning, not proof that no adapter
exists anywhere. Local source inspection also found the existing portable
contracts, reference loop and examples. Those remain their single source of truth.

## Objectives and acceptance

The four intake acceptance criteria below are reproduced verbatim from the native
BI read at `2026-10-21T07:07:11.653Z`. Their labels are local traceability aids;
the statements retain the item's existing scope.

| Intake reference | Existing acceptance criterion |
|---|---|
| I-HER-1 | Import/validation and bounded execution are reproducible on a named Hermes version. |
| I-HER-2 | A capability/loss report separates instruction compatibility from runtime enforcement. |
| I-HER-3 | Target-profile qualification/equivalence is supported by evidence; no inherited DPF authorization is assumed. |
| I-HER-4 | If mandatory execution controls cannot be implemented safely, provide a reviewed incompatibility result and safe supported posture; do not claim full conformance. |

The objectives and checks below refine those criteria for design review. They do
not replace the intake criteria, freeze a baseline/profile or add normative
requirements to TAK, GAID, JSI or GPP. Runtime acceptance remains future work
under the item's existing dependency on BI-07A2B207. I-HER-4 is an explicitly valid
possible outcome; this design does not require a full-conformance result.

**OBJ-HER-IMPORT:** Map an inspected package into a reproducible, inert Hermes projection without copying installation state or losing source derivation.

**OBJ-HER-CONTROLS:** Report every material semantic loss and hold activities whose mandatory controls are unsupported or unproven.

**OBJ-HER-EVIDENCE:** Preserve exact composition, authority, effect and qualification evidence boundaries, including uncertain execution.

| Acceptance | Objectives | Statement | Proposed evidence |
|---|---|---|---|
| AC-HER-01 | OBJ-HER-IMPORT | An independently trusted package inspector and the existing semantic importer check the exact package and artifacts before target projection; required unknown meaning holds the affected import. | Package/contract negative fixtures and source-to-projection reconciliation. |
| AC-HER-02 | OBJ-HER-IMPORT | The projection identifies each input, output and transformation by immutable reference and digest; it carries no credentials, local grants, private memory, live schedules or authenticated endpoint configuration. | Allow-list, privacy and complete output inventory inspection. |
| AC-HER-03 | OBJ-HER-CONTROLS | Every required control maps to the selected work and all reachable effect paths, with implementation identity, evidence and a supported, unsupported or unknown finding; declarations never become assessed results. | Control matrix, missing-path and false-declaration fixtures. |
| AC-HER-04 | OBJ-HER-CONTROLS | Hook action, failure and argument-mutation semantics are translated explicitly; absent mediation or required approval prevents dependent effects. | Crash, timeout, missing-hook, malformed-response and argument-change cases on the eventual named target. |
| AC-HER-05 | OBJ-HER-EVIDENCE | Every consequential attempt uses the existing exact-effect binding, current target authority and authenticated original-writer evidence; hook/session identifiers alone cannot settle it. | Binding mutation, revocation and evidence-disagreement cases. |
| AC-HER-06 | OBJ-HER-EVIDENCE | Possible dispatch followed by loss of response, cancellation or restart remains unknown until authoritative reconciliation; resume, rollback and annotations do not authorize replay. | Lost-transport, surviving-child and recovery cases. |
| AC-HER-07 | OBJ-HER-EVIDENCE | The report preserves original qualification scope and requires target assessment or attributable scheme-defined equivalence before a qualification claim. | Changed-composition, expired, inaccessible and conflicting-evidence cases. |
| AC-HER-08 | OBJ-HER-IMPORT, OBJ-HER-CONTROLS, OBJ-HER-EVIDENCE | A reviewed incompatibility result identifies the exact unsupported mandatory requirement, affected activities, evidence limits and nonexecuting supported posture; it makes no full conformance claim. | Bounded incompatibility specimen and independent assessment. |

| Existing scope | Proposed checks that support it |
|---|---|
| I-HER-1 | AC-HER-01, AC-HER-02, AC-HER-04–06; OBJ-HER-IMPORT and OBJ-HER-EVIDENCE. The named Hermes build must eventually be observed, not selected or inferred by this design. |
| I-HER-2 | AC-HER-03, AC-HER-04, AC-HER-08; OBJ-HER-CONTROLS. |
| I-HER-3 | AC-HER-05, AC-HER-07; OBJ-HER-EVIDENCE. |
| I-HER-4 | AC-HER-03, AC-HER-06, AC-HER-08; OBJ-HER-CONTROLS and OBJ-HER-EVIDENCE. |

All proposed implementation and runtime evidence above is **UNRUN**. This source
design neither satisfies the item's reproduction acceptance nor closes it.

## Research & Benchmarking

Reuse the completed *Hermes Agent and Cursor portability research*, 20 October
2026, and its 25-source register. Report SHA-256 is
`783ee1436f2e7ed53fff95952272323b3a1d2943a711b131295706fd93962154`;
canonical contribution activity is `cmvgttebn89ie01ldiv74h198` on BI-07A2B207.
Its nine candidate runtime cases remain unrun. Documentation findings are distinct
from runtime verification and from evidence of an independently qualified target.

The package owner's pinned design above contains the broader data-model
comparison. Reuse its comparison rather than select another package format here:

| Official comparator | Pattern used for the Hermes projection | Limit preserved |
|---|---|---|
| [Agent Skills](https://agentskills.io/specification) | Instructions and resources retain their declared source and compatibility. | Experimental `allowed-tools` is not target authority. |
| [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | Preserve tool schemas and negotiated protocol identity where supported. | Server names and tool annotations do not establish principal identity or safe replay. |
| [Agent Plugins 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md) | Compare component loading separately from the closed package inventory. | Permissive host loading cannot negotiate mandatory TAK controls. No dependency is adopted. |
| [Cursor plugins](https://cursor.com/docs/reference/plugins) | Compare host component paths and declared version/source identity. | Host import is not evidence of Hermes equivalence. |
| [Claude plugins](https://code.claude.com/docs/en/plugins-reference) | Compare distributable components and local configuration boundaries. | Host plugin permissions cannot be transferred to Hermes. |
| [VS Code extension manifest](https://code.visualstudio.com/api/references/extension-manifest) | Compare explicit host compatibility and dependency relationships. | An extension package is not a shared execution or qualification boundary. |

One unresolved carrier detail was refreshed from the official
[Hermes distribution documentation](https://hermes-agent.nousresearch.com/docs/user-guide/profile-distributions)
on 21 October 2026: `distribution.yaml` describes `name`, `version`, `description`,
`hermes_requires`, `author`, `license` and `env_requires`; `distribution_owned`
can narrow copied content. Version compatibility is not exact build identity.
`SOUL.md`, `config.yaml`, `skills/`, `mcp.json` and `cron/jobs.json` are native
content locations. Updates can preserve local configuration, merge skills and
scheduler definitions, and retain job enablement. Installer exclusions do not
protect secrets committed by an author. These findings support a derived
projection and effective-composition check; they do not admit native installation.

There is one suitable design path within the existing owners: inspect using the
package owner, derive a target projection, then report control fit before any
separate target activation. Direct native import cannot replace package inspection.
Hooks alone cannot discharge complete mediation. A new universal runtime, policy
engine or independent adapter registry would duplicate existing owners and is
outside this item. Choosing among future confinement or mediation implementations
requires target evidence and later admission; this design makes no such choice.

## Inert import and projection

The future adapter consumes the package owner's successful inspection result,
exact inventory bytes and validated artifacts. It does not run `hermes profile
install`, a package-supplied verifier, plugin, hook or script to validate its input.
The inspector is trusted independently of the package. Missing package tooling
remains a dependency hold, not permission to write a second archive parser here.

The package's `source`, `generator`, `selection`, `files`, `dependencies`,
`references`, `controls`, `restrictions`, license inventory and mandatory
extensions retain the meanings at revision `2067baab3c199119cd2108f5fe3169c8193a6310`.
In particular, a `Control.declaredSupport` assertion is not an assessed finding.
An inaccessible required reference holds the check needing it. No remote schema,
dependency or private reference is fetched automatically.

The adapter reuses the existing semantic importer with explicit observation time
and exact extension validators. Unknown mandatory versions or semantics fail;
unknown optional data is retained within the owner's bounds and remains inert.
Only the existing sequential work projection is supported. Parallel/token flow,
unresolved stage transitions or GPP bindings are reported, never flattened.

| Package content | Proposed Hermes projection | Required loss or hold check |
|---|---|---|
| Selected instructions, skills and resources | Derived `SOUL.md` and allow-listed `skills/` entries, preserving source-to-output identity. | Preserve separate WWMD/WWWD/WSID references and activation semantics; concatenating prose cannot replace owning-scope resolution. Missing resources or ambiguous instruction precedence hold the affected projection. |
| Reusable composition and model requirements | Inert candidate `config.yaml` values and compatibility descriptions. | No provider, model, credential or host is selected now. A later range match cannot replace an observed build and effective configuration. |
| Tool contracts | Human-readable requirements and inert candidate connection descriptions. | No executable `mcp.json`, command, authenticated URL, secret reference or account mapping is activated by import. Local target authority resolves them later. |
| Work stages, limits and stop/review conditions | Retained portable work artifact and control report. | No automatic conversion into cron jobs, autonomous work or a second scheduler. Schedules remain absent from the initial projection. |
| Qualification and evidence references | Attributed references with source restrictions and known validity scope. | No source subject, GAID, grant, assessed status or private evidence is adopted by the new target. |
| Required enforcement and hook descriptions | A proposed mapping in the report, with any source code retained as inert reference material. | No imported hook runs during inspection; unsupported or untested mandatory behavior holds activation. |

Each proposed output records the source package inventory/archive identities,
source file identities, adapter revision, transformation parameters and exact
output digest through the existing package provenance model. Native display name
and `version` cannot replace those identities. Native manifest fields are a lossy
projection; the full required semantics remain in the inspected package and report.
Do not hide a required control in a custom native field and assume Hermes enforces
it. An unrepresentable mandatory requirement holds the affected activity.

Projection writes, when separately implemented and admitted, use a fresh inert
staging directory under the package owner's safe-path and bounded parsing rules.
That directory must be outside every active or configured Hermes home, profile,
configuration, skill, hook, plugin, MCP and cron/scheduler discovery root. Reject
path redirection into those roots, including symlinks in existing parent paths,
even when the final directory would be newly created. No native install, profile
import, component registration, startup or `HERMES_HOME` reassignment is invoked.
Native destinations are mapping data only: archive extraction cannot target
`~/.hermes` or weaken the package owner's portable path grammar. Projection cannot
overwrite managed policy, an existing profile or local state. This design creates
no such directory or generated host configuration.

## Control-fit report and mandatory-control holds

The report is a projection of existing requirement and evidence references, not
a new persisted authority object or qualification status vocabulary. Reuse the
canonical evidence carriers and `Ref`/restrictions contracts. Its minimum contents
are the following reviewer-visible associations:

| Association | Required information |
|---|---|
| Input identity | Package/archive/inventory digests, source commit, contract versions, adapter revision and selected work/profile references. |
| Target identity | Proposed versus actually observed Hermes build, OS, execution surface/mode, effective configuration and policy/hook/component digests; unknown values stay unknown. |
| Per-control mapping | Canonical requirement reference/version, mandatory flag, affected stages/capabilities, reachable effect paths, proposed implementation reference and evidence references. |
| Finding | Declared support separately from supported/unsupported/unknown assessment; reason, semantic difference, evidence source/time/scope, and any excluded path. |
| Consequence | Which activity is held, which nonconsequential content remains inspectable, what evidence could resolve the hold, and its existing accountable owner. |
| Qualification | Original scheme/status/subject/composition/assessor/validity and any attributable target assessment or scheme-defined equivalence; unresolved current status is unknown. |

Absence of documentation is an unknown finding, not proof that Hermes lacks a
capability. A documented feature is a proposed mapping until observed on the exact
target. A passing test covers its stated conditions only. Neither a host's own
claim nor the adapter author's exercise is an independent assessment.

All paths reachable by the eventual work must be enumerated: native file tools,
shell/interpreters, direct code/subprocesses, HTTP or other network clients, MCP,
plugins, subagents, scheduled/background work and any configured remote executor.
Unselected or independently disabled paths need attributable evidence of that
boundary; hiding a tool in a prompt is insufficient. Required controls apply to
descendants and late effects as well as parent calls.

The report must hold the whole dependent activity when a reachable path cannot
be bounded. Restricting one path is useful only if no alternative path can perform
the same effect outside the declared boundary. This is a later verification
obligation, not a confinement claim made by this document.

## Hooks, authority and exact effects

The completed research's official [hooks source](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks)
documents `pre_tool_call` block/approval/argument-change behavior. Hermes
`action: "approve"` requests human approval; it is not auto-allow. Shell hook
infrastructure errors normally fail open unless `fail_closed: true` applies.
Timeout-bounded Python policy callbacks have a different blocking rule. Observer
returns are ignored and result transformations can change model-visible output.

A future mapping that relies on a shell policy hook must require its applicable
fail-closed behavior and verify crash, timeout, malformed output and missing-hook
startup separately. An error-return setting cannot establish that a hook was
loaded or executed. After argument mutation, re-resolve the exact effect and
current authority; an earlier approval cannot cover materially different input.
Approval requests remain held while required approval is absent or unavailable.
Policy callbacks themselves must not perform the governed effect.

Official [security documentation](https://hermes-agent.nousresearch.com/docs/user-guide/security)
states that command checking is not an OS sandbox and direct subprocess execution
inside `execute_code` can bypass shell-pattern checks. Therefore a shell hook or
command allow-list alone cannot satisfy complete mediation. The
[managed-scope mechanism](https://hermes-agent.nousresearch.com/docs/user-guide/managed-scope)
also has a malformed-configuration ignore behavior. The adapter must verify the
effective control, its protected source and its failure behavior, rather than
infer enforcement from configuration presence.

The future effect adapter must satisfy the existing consumer contract: an
authenticated target principal and current grants; exact actor/tool/target/account,
arguments digest and canonicalization, purpose, work/profile revisions, policy
generation and GPP binding/shape revisions; durable reservation before dispatch;
authenticated state and revision/CAS; atomic state/outgoing-command persistence;
and reauthorization at actual use. The pure reference loop supplies requests for
those operations, not their runtime implementation.

DPF's governed MCP executor and ToolExecutionReceipt remain DPF-owned. A Hermes
request cannot inherit their authority merely by knowing a tool or reference name.
Any later target integration uses its own accountable identity and the current
authorized service boundary. No credential, account, grant or connection is
created or changed here.

## Uncertainty, evidence and revalidation

Preserve effect identity separately from attempt identity and host correlation
identifiers. A hook event, session ID, subagent summary, process exit or model-visible
tool result is evidence only within its authenticated provenance; none alone is
an authoritative external-effect receipt. Retain original-writer evidence
separately from transformed or summarized model output.

The official [MCP configuration reference](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
describes OAuth for HTTP MCP and approval behavior affected by server trust and
read-only hints. It also describes transparent replay of calls marked read-only
after transport expiry, while uncertain unannotated writes require verification.
Those are protocol/host behaviors, not proof of harmlessness or current service
authority. A consequential operation must not enter a replay path whose safety
depends only on an untrusted annotation. If the chosen integration cannot preserve
the required reservation and reconciliation boundary, that activity stays held.

After possible submission, timeout, cancellation, restart or lost output maps to
the existing `unknown` observation until target evidence establishes an outcome.
No new attempt is admitted while the prior effect is uncertain. The existing loop
requires observation-only recovery before replay, original effect identity, fresh
attempt identity, remaining bounds and current authorization. File rollback and
session continuation do not settle remote effects. A stopped parent does not prove
that descendants stopped or cannot emit a late effect.

The target evidence record must bind exact Hermes build and surface, effective
profile/model/tool/memory composition, policy and hooks, adapter/package identities,
selected work and normative versions, original request/attempt, actual observation,
recovery evidence and unresolved exclusions. Sensitive bodies stay with their
existing owner; export uses permitted references and restrictions, not raw secrets
or private transcripts. Even identifiers and digests require disclosure review.

Native updates can preserve local configuration and state. Therefore a distribution
commit or restored file set cannot fingerprint the effective target composition.
Material change to build, model/provider, instructions, skills, hooks, tools,
memory/corpus, work, policy, oversight or endpoint identity requires the relevant
fit checks and qualification/equivalence decision again. Preserve prior results
as historical evidence rather than silently carrying their status forward.

## Verification and bounded incompatibility result

Reuse PC-01–08/CT-01–08 from BI-F9582C48 and AC-PKG-001–012 from BI-07A2B207
with their own actual source identity and outcomes. They are prerequisites and
traceability, not a claim that this Hermes target passed them. The adapter's future
static checks cover source/output closure, private-data exclusion, mandatory loss,
unknown references, changed composition and deterministic reporting without DPF.
Synthetic examples use the independently trusted package runner and label every
observation simulated with `conformanceClaim: none`.

A proposed negative fixture must reject a fresh staging path inside a configured
discovery root, including a hook directory, and a seemingly external path whose
parent symlink redirects there. Inspection must cause no component import,
registration or startup. This fixture is **UNRUN** and supplies no runtime proof.

The nine completed-research cases provide the future runtime assessment candidates:
permit/deny/escalation; hook failure; argument mutation; alternative effect paths;
lost transport; surviving descendants; authority/configuration change; update and
restoration; and evidence disagreement. All nine remain **UNRUN**. No commands or
runtime specimens are added by this design. A later plan must bind a selected,
authorized synthetic target and the owning assessment denominator before execution.

Where a mandatory control is demonstrated incompatible, retain the package and
target identities, exact requirement, supported conditions, conflicting behavior,
authoritative observations, affected activities and remaining unknowns. Keep
dependent effects disabled. Content may remain available for inert inspection;
any later advisory model use is separately admitted and cannot imply enforcement
or qualification. An unknown mapping remains an evidence hold, not a global
assertion that Hermes can never support the programme.

Independent assessment belongs to the existing JSI/family processes. The current
design can be reviewed as a design or incompatibility approach; it cannot declare
Hermes assessed, qualified, GPP-Enforced, GPP-Evidenced or fully conformant.

## Delivery boundary

This draft changes one design source. It adds no API, schema, migration, package,
service, install path, host default, scheduler or runtime implementation. Canonical
Organization/Principal identity and existing source/evidence owners remain intact.
No credentials, rights decision, outreach, target selection or public release is
part of this action.

The next delivery stage is the normal independent design/review and plan process
for this existing item, preserving the BI-07A2B207 dependency and its own current
holds. Source/document checks can establish draft quality only. The programme's
other review, publication and execution holds are neither retried nor superseded.
