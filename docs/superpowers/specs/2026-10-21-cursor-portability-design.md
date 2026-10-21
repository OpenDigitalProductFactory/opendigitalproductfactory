---
status: draft
---

# Cursor portability: import projection and semantic-loss contract

**Backlog:** BI-0E56BA38 · **Epic:** EP-B932453F · **Workroom:** WC-ADDEE529
**Shape and phase:** delivery-medium@1.0.0; design only, admitted by `IRD-BF4222CC733F` at `2026-10-21T07:03:00.856Z`.
**Source inspected:** `97ecc0c1032c737da6b399c4db78e9792e4f0018`.

Cursor is an existing candidate reproduction in the programme. This design
specifies how its eventual adapter can consume the same portable definitions,
report unsupported meanings and retain qualification/effect boundaries. It does
not choose a Cursor version, execution surface, account, model, policy profile or
first runtime target. It implements nothing and reports no runtime test as run.

The item's final outcome is reproduction on a named observed surface. A design
draft is a partial contribution to that outcome. Runtime delivery remains
dependent on BI-07A2B207's package and subsequent ordinary design/plan/coverage/
implementation admission. No installation, account or grant change, tool adoption,
paid review, publication or outreach follows from this document.

## Existing owners and verified gaps

| Existing owner | Reuse | Boundary established by source inspection |
|---|---|---|
| [Portable contracts, BI-F9582C48](2026-09-27-portable-tak-contracts-design.md) and `packages/validators/src/trusted-agent-contracts.ts` | Five strict versioned artifacts, bounded JSON, exact reference/restriction and extension validation, generated JSON Schema. | Preserve their semantic owner. Schema validity is weaker than import semantics, current authority and target conformance. |
| `packages/validators/src/trusted-agent-reference-loop.ts` / `trusted-agent-examples.ts` | Pure transition functions and simulated examples, PC-01–08 / CT-01–08. | Commands are adapter requests, not effects or grants. Unknown effects retain original identity and reconciliation duty. |
| [Approved BI07 carrier design at 2067](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/2067baab3c199119cd2108f5fe3169c8193a6310/docs/superpowers/specs/2026-10-21-portable-reference-package-design.md) | Proposed immutable inventory 1.0.0, safe archive/inspection, dependency/license closure, independent trusted runner. | This source design is approved; the carrier implementation/release is still proposed and unaccepted. This item must not fork or implement that carrier. |
| `apps/web/lib/routing/execution-adapter-types.ts`, `execution-adapter-registry.ts`, `resolve-execution-adapter.ts` | Existing typed inference-adapter interface, registration and required-capability refusal. | No Cursor kind is present in the inspected typed set. This content projection is not a newly registered inference handler; no fallback to `chat`, Codex or another identity is implied. |
| `packages/dpf-skill-pack/client-capabilities.json` and `packages/integration-shared/src/client-capability-profile.ts` | One owner for version/host-specific verified, encoded and unproven client capabilities. | Its inspected keys are claude-code, codex, grok, antigravity and vscode; there is no Cursor row. Vendor documentation cannot create a verified row. A future reviewed change needs source passages and live evidence. |
| `packages/dpf-bootstrap/src/agent-toolchain/` | Existing data-in/data-out plans and separate filesystem application, redaction and prerequisite reporting. | Reuse that separation if later Cursor onboarding is admitted. Do not add a second installer or make bootstrap/account changes in this design. |
| `apps/web/lib/mcp/transport-auth.ts`, `session-token.ts`, `load-tools.ts`, `apps/web/lib/mcp-governed-execute.ts` | Existing authentication, scoped discovery and action-owning execution boundaries. | MCP configuration and a tool name are not current grant intersection, a sponsor identity or an effect receipt. No credential export or new trust grant. |
| `apps/web/lib/tak/tool-execution-receipt.ts`, existing TaskRun/TaskArtifact/DocumentBlob/DocumentVersion | Existing effect reservations/receipts, task provenance and immutable retained evidence. | Store later mapping/evidence as derived artifacts through existing carriers. No Cursor policy database, shadow task queue or competing receipt ledger. |
| [External-agent operating profile design](2026-08-23-external-agent-operating-profile-design.md) | Preserve its principal-bound orientation and distinction between business operation and platform development. | It is an existing design with its own admission/delivery status; this draft does not assert that its whole proposed API is deployed or implement it under a Cursor name. |

The registry comparison is a bounded source fact, not a universal assertion that
no Cursor integration exists anywhere. The relevant deployment contracts and
owning normative sources remain [TAK](../../architecture/trusted-ai-kernel.md),
[GAID](../../architecture/GAID.md), [TAK-JSI](../../architecture/job-specific-intelligence.md),
[GPP](../../architecture/gated-permissions-process.md) and
[deployment contracts](2026-05-09-deployment-contracts.md). No public API,
migration, install default or running service changes here.

## Objectives and observable acceptance

These proposed identifiers describe BI0E's eventual implementation acceptance;
they are not a frozen conformance denominator or an already minted baseline.

The existing intake acceptance remains authoritative. The proposed detailed
criteria below refine how to observe it; they do not replace or broaden it:

| Existing BI-0E56BA38 acceptance, verbatim | Proposed detail |
|---|---|
| A named Cursor version/surface can reproduce the documented supported profile. | AC-CUR-010, AC-CUR-011, AC-CUR-012 |
| Skill import is not represented as enforcement or job qualification. | AC-CUR-003, AC-CUR-008 |
| Unsupported mandatory requirements prevent the affected conformance claim or activity. | AC-CUR-004, AC-CUR-005, AC-CUR-012 |
| Evidence and adapter mapping are portable and do not assume DPF-local grants or secrets. | AC-CUR-001, AC-CUR-009, AC-CUR-010 |

**OBJ-CUR-001:** Derive an inspectable Cursor content projection from the same immutable portable package without creating another editable definition or policy store.

**OBJ-CUR-002:** Make every required semantic loss and unproven enforcement boundary explicit, holding affected import, activity and claims rather than degrading silently.

**OBJ-CUR-003:** Preserve original identity, authority, qualification and effect/evidence provenance across Cursor surfaces, continuation and updates.

**OBJ-CUR-004:** Make the eventual reproduction independently assessable on an exact observed Cursor composition using shared cases and truthful result limits.

| Acceptance | Objectives | Statement | Proposed evidence, all UNRUN |
|---|---|---|---|
| AC-CUR-001 | OBJ-CUR-001 | The projection identifies the source package, inventory/archive digests, generator version and every source-to-target mapping; the same validated inputs produce the same projection bytes. | Determinism and changed-input vectors. |
| AC-CUR-002 | OBJ-CUR-001 | Inspection and staging leave all Cursor discovery directories, user configuration, accounts, credentials, hooks, MCP connections and schedules unchanged; archive-supplied code remains inert. | Filesystem/process/network observations and malicious self-consistent archive cases. |
| AC-CUR-003 | OBJ-CUR-001, OBJ-CUR-002 | Skills, rules and plugin content are reported as context/discovery mappings with exact losses, without asserting authority, enforcement or job qualification from their presence. | Mapping/schema comparison and claim review. |
| AC-CUR-004 | OBJ-CUR-002 | Every mandatory version, extension, control, reference or flow with unsupported or unknown semantics holds the affected semantic import/activity and conformance claim; optional unknown content remains bounded, inert and visibly unassessed. | Mandatory/optional matrix, including absent proof and inaccessible references. |
| AC-CUR-005 | OBJ-CUR-002 | The eventual executing composition enumerates every reachable effect path and proves the required mediation on that exact surface; paths without adequate evidence remain unavailable to the dependent activity. | Shared alternative-path and hook-failure cases. |
| AC-CUR-006 | OBJ-CUR-002, OBJ-CUR-003 | Missing, failed, malformed, late or mutated hook/approval input cannot become permission; material argument, target, principal, policy or profile changes require the owning authority to re-evaluate before effect. | Failure, absent-hook, mutation, revocation and expiry cases. |
| AC-CUR-007 | OBJ-CUR-003 | A missing response, resumed conversation, parent exit, checkpoint, SDK send key or file restoration never proves settlement or authorizes replay; uncertain work retains original operation and descendant provenance. | Lost-transport, surviving-child and restart cases with original-writer/target evidence. |
| AC-CUR-008 | OBJ-CUR-003 | GAID/JSI claims remain scoped to their original subject/profile and assessor; a Cursor target becomes assessed or qualified only through target assessment or attributable scheme-defined equivalence. | Changed-composition and unsupported-equivalence cases. |
| AC-CUR-009 | OBJ-CUR-001, OBJ-CUR-003 | Projection/update preserves source restrictions and per-file redistribution disposition, excludes secrets/private instance data and does not overwrite local grants or reinterpret imported declarations as live identities. | Nested data/reference scanning, license review and update diff. |
| AC-CUR-010 | OBJ-CUR-004 | Every observation binds exact Cursor build, execution surface, OS, mode, policy/hook/configuration and relevant dependency digests, source profile and original request; missing facts remain unknown. | Evidence completeness and changed-composition checks. |
| AC-CUR-011 | OBJ-CUR-004 | The eventual reproduction runs the applicable shared contract/runtime cases with explicit pass, fail, inconclusive, unsupported or unrun results and independent reproduction remains distinguishable from author testing. | PC/CT traceability, nine-case ledger and independent assessment. |
| AC-CUR-012 | OBJ-CUR-002, OBJ-CUR-004 | An unverified or changed target configuration, unsupported mandatory requirement or unavailable required evidence prevents a named supported-profile claim; the design draft itself does not satisfy the item's runtime acceptance. | Claim-generation negatives and outcome reconciliation. |

## Research & Benchmarking

Reuse the completed **Hermes Agent and Cursor portability research**, 20 October
2026: 25 official pages, eight control areas, nine candidate runtime cases **all
UNRUN**. Report SHA-256 is
`783ee1436f2e7ed53fff95952272323b3a1d2943a711b131295706fd93962154`, source-register
SHA-256 `cca229362ac2dd42eb3c6d67c973892a5fb27472fe245911f68183da450e876d`;
BI07 activity `cmvgttebn89ie01ldiv74h198` records that documentation contribution.
Do not regenerate it or transform it into runtime proof. BI07's approved design
also provides the package-format comparison; this design reuses its primary-source
links and reasoning where applicable.

| Comparable | Concrete model and useful pattern | Deliberate limit |
|---|---|---|
| [Agent Skills](https://agentskills.io/specification) | Portable name/description plus instructions/resources and optional metadata. Preserve exact selected resource closure. | Experimental allowed-tools metadata cannot express or enforce complete TAK authority. |
| [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | Named tools, input/output schemas, annotations and structured results. Reuse negotiated protocol/schema identity. | Annotation and configured server name are not authenticated actor/endpoint identity, authorization or settlement. |
| [Agent Plugins 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md) | Root plugin manifest, skills/MCP components and optional namespaced extensions. Candidate distribution binding over the BI07 inventory. | Permissive unknown/non-object extension handling and partial client components cannot preserve a mandatory TAK requirement by themselves. |
| [Cursor plugin model](https://cursor.com/docs/reference/plugins) | Native component paths and configuration variables, alongside the standard plugin format. Model each field/variable translation explicitly. | A plugin is a content carrier, not control proof. Its secrets remain target-owned. |
| [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference) | Explicit component/dependency/configuration projection offers a commercial comparison for host-specific packaging. | Do not copy its hook envelope, root-variable spelling, approval meaning or unknown-field behavior into Cursor by analogy. |
| [VS Code manifest](https://code.visualstudio.com/api/references/extension-manifest) | Identity, version, engine compatibility and extension dependencies make compatibility prerequisites visible. | Extension install/signature/marketplace checks do not establish effect mediation or JSI equivalence. |

The smallest sound approach is to reuse the carrier/importer and add a derived
Cursor mapping with visible losses. Copying a full Cursor profile would mix
private instance state and executable settings into a reusable definition.
Building a replacement host/policy engine would duplicate owners and still need
target evidence. Neither competitor addresses this item's portability boundary.
No executing host is chosen by preferring the reusable content representation.

Four official Cursor pages were refreshed on 21 October solely to resolve
projection/control facts; no runtime or API probe occurred:

- [Skills](https://cursor.com/docs/skills): project `.agents/skills` and
  `.cursor/skills`, user discovery and explicit invocation have different scopes.
  Local user content is not automatically present on every remote/cloud surface.
  Preserve resource and invocation conditions; an imported instruction remains
  agent context rather than a policy gate.
- [Plugins](https://cursor.com/docs/reference/plugins): standard root `plugin.json`
  and native `.cursor-plugin/plugin.json` are distinct carriers. Standard
  `PLUGIN_ROOT`/`PLUGIN_DATA` substitutions are unsupported; documented native root
  substitutions differ. The adapter must report such losses instead of executing
  a partially expanded command or silently rewriting arbitrary configuration.
- [Hooks](https://cursor.com/docs/hooks): generic `preToolUse` accepts but does not
  enforce `ask`; dedicated shell/MCP events differ. Failure defaults, `failClosed`
  and invalid-response handling are distinct. Cloud hooks can start after early
  read-only turns; specific lifecycle/MCP hooks are deferred there. Post-tool
  transformations and lifecycle summaries do not constitute original effect proof.
  These distinctions prohibit an untested universal hook claim.
- [SDK](https://cursor.com/docs/sdk/typescript): local describes loop/filesystem
  placement while inference remains hosted. Headless local defaults have no
  interactive approval and sandboxing is off; Auto-review can fall back when
  unavailable and is not a security boundary. Custom tools have a distinct approval
  path. Send idempotency and local/cloud continuation are not target-effect
  settlement. No SDK dependency or account is adopted here.

## Proposed import and projection boundary

The adapter has a pure **inspect/project** part and a separate future
**activate/execute** boundary. Only the first is specified as nonexecuting output
here; the second requires a named assessed composition and ordinary admission.

1. Obtain the BI07 release and independently trusted verifier through its owning
   release process when available. Bind inventory, archive, sources, restrictions
   and exact versions; do not execute the archive's own verifier or runner.
2. Validate the complete package using BI07's limits/inventory and F958 semantic
   importer before projecting anything. Unknown mandatory semantics hold; no
   remote schema/package fetch, credential import or silent truncation is allowed.
3. Derive a deterministic mapping and **inert staged content** outside any Cursor
   project/user discovery directory. No write to `.cursor`, `.agents`, home
   configuration, plugin cache or marketplace occurs. No hook/command/MCP startup
   file is activated, even if the source contains one.
4. Resolve required references or report unknown under their current access and
   destination policies. A summary/digest does not replace unread required bytes
   or a native original receipt. Authenticated references stay references offline.
5. Return the staged content plus loss report for source review. Only a separately
   admitted target-owned operation may apply selected outputs after validating the
   actual surface, authority and executable provenance. Inspection success is
   never an activation permit.

BI07's first archive uses safe ASCII output paths and rejects leading-dot
segments. Therefore proposed destination paths such as `.agents/skills/...` or
`.cursor-plugin/plugin.json` are **mapping data**, never archive member names or
direct extraction destinations. Carrier content remains at safe declared paths
such as `skills/<name>/SKILL.md`. A later explicit activation step materializes an
allow-listed target layout; do not weaken the carrier path grammar to accommodate
Cursor discovery. A staging directory that Cursor can already discover is not inert.

The initial content projection preserves standard Skills instructions/resources
and exact governing references, with machine-visible unsupported controls. A
standard Agent Plugins or native Cursor wrapper is an optional later projection
when its required components/variables are proven lossless. Do not add MCP
configuration, hooks, executable commands, schedules or automatic invocation as
a convenience of importing the content.

## Derived mapping artifact

Use the existing immutable document/task-artifact carriers for a generated
`cursor-projection.json` report; no new persistence model or authority store.
Its proposed report format is `cursor-projection/0.1.0`, independently versioned
from the BI07 inventory and F958 artifacts. The future implementation plan must
bind its concrete schema to the package projection/inspection owner, not create
a Cursor registry of definitions or rules.

| Report field | Meaning and validation |
|---|---|
| `source` | Package identity/version, inventory/archive digests, generator reference, all governing definition/profile versions; exact source-to-output derivation. |
| `targetObservation` | Surface family, exact build/SDK/OS/model/policy/hook/configuration identities, observation time and evidence references. Every not-observed value is null/unknown; this design fills none with a selected runtime. |
| `mappings` | One row per selected requirement/artifact: canonical reference, required flag, proposed target carrier/path, mapping status, losses, documentation basis and separate runtime evidence references. Sort by canonical reference; reject duplicates or ambiguous targets. |
| `results` | Separate structural/integrity/import readiness, unsupported/unknown required semantics and origin status; optional content never supplies authority. |
| `claims` | Original attributable evidence scope/status and target unassessed status, with source restrictions; no new assessed/qualified claim from projection. |
| `limits` | Unrun cases, inaccessible evidence, surface-dependent gaps, incomplete closure and required resolution; no blanket pass when any required observation is missing. |

Mapping status distinguishes a faithful **content mapping**, an **unsupported**
meaning and an **unknown** meaning. A content mapping says nothing about runtime
enforcement. Any required unsupported/unknown row derives a hold on the affected
semantic import/activity and claim; partial useful inspection may continue as
read-only reporting. It cannot drop that row, relabel it optional, or make the
blocked activity available through another tool path. Optional unknown extensions
round-trip inert within F958 bounds (depth16,20,000 visited values,1,048,576 combined
key/string UTF-16 characters,32 extensions and bounded diagnostics), with no
evaluation of imported JavaScript or policy expressions.

The report records source facts and separate observations, not editable global
policy. Rebuild it when any source inventory, host composition, mapping version,
control requirement or restriction changes. Do not hash secrets or private raw
configuration into a public descriptor; retain protected exact evidence through
existing access controls and disclose only permitted references.

## Control translation and semantic-loss rules

| Concern | Required adapter behavior | Hold condition |
|---|---|---|
| Rules/skills | Keep source identity, version, scope and exact instruction/resource closure. Describe content/invocation differences explicitly. | Required discovery or instruction semantics unobserved or changed; loading content cannot discharge enforcement. |
| Tools/MCP | Bind canonical tool/schema and authenticated endpoint/actor/target separately. Resolve grants and GPP bindings in the owning runtime at use. | Missing endpoint identity, current authority, required tool constraint or canonical writer; no DPF-local grant/credential copied. |
| Permission/approval | Translate event-specific outcomes, preserving deny, hold and required human decision. Generic and dedicated hook envelopes are not interchangeable. | Missing or nonenforced approval means hold; no approval-by-timeout, schema acceptance or generic allow. |
| Mutation | Bind exact final arguments, target/account, purpose, scope, profile and policy generation before effect. | Material mutation after decision requires renewed authorization; source restrictions remain checked. |
| Hook availability/failure | Prove event delivery, effective precedence and failure handling for the selected surface before depending on it. | Absent/late hook, crash/timeout or incomplete coverage cannot enable the dependent effect; setting a flag is not proof it fires. |
| Alternative paths | Enumerate file, shell/interpreter, subprocess, network/Fetch/browser, MCP, SDK custom tools and delegated agents. Attribute each required control to an observed enforcement owner. | Any reachable uncontrolled mandatory path holds the dependent activity; no route fallback, shell workaround or narrower-looking renamed profile. |
| Flow/GPP | Preserve versioned work shape, gate binding and sequential/parallel/token semantics under F958. | Unsupported flow or shadow/off/unknown enforcement cannot be flattened into a supported profile. |
| Evidence | Keep original call/task/attempt/parent-child identities and authenticated producer provenance. Preserve source observations separately from model-visible transformations. | Missing/truncated/redacted/conflicting/late events remain unknown; tool counts, parent summary and process exit cannot close the effect. |
| Updates | Rebuild/diff mappings and revalidate changed package, configuration, authority and qualification inputs. | Restore of files/session cannot restore expired grants or undo remote effects; original uncertain work remains held. |

This design does not claim that the whole Cursor host can currently enforce
these conditions. They are prerequisites to the eventual bounded supported-profile
claim. A read-only content demonstration is explicitly narrower than governed
effect reproduction and cannot close the BI by itself.

## Surface identity, execution and recovery

IDE/desktop local, CLI/headless, SDK local, hosted cloud and self-hosted/remote
workers are distinct observation rows. Sharing a product or API does not establish
equal hooks, credential handling, sandbox, filesystem/network controls, child
process behavior or evidence. Do not pick a version from release notes as if it
were installed. An eventual assessment records actual build, OS, model/composition,
surface/mode, restrictions, effective policy/configuration sources and digests,
hook versions, MCP transport/endpoint identity and original request correlation.

The eventual adapter can request a F958 transition only from an authenticated
event with its exact binding. It cannot turn a generated instruction into a
reservation, a logged request into an effect receipt, or a Cursor session ID into
a DPF principal. DPF-owned effects re-enter existing governed execution and native
writer paths; non-DPF targets need their own attributable authority/effect proof.
If that proof cannot be obtained through a supported authorized reader, retain
unknown and hold rather than proxy a denied read or create a new attempt.

No new inference adapter kind/handler, account, external-client registry row or
toolchain hook is introduced now. If later implementation requires routed
inference, it must extend the existing adapter substrate under its actual scoped
plan and evidence; do not pretend the pure content projection already supplies it.

Unknown external outcome follows the existing F958 reconcile-before-retry rule.
Retain original request/attempt identity, descendant relationships and possible
late effects across stream failure, cancellation and resume. Reconciliation may
observe after revocation but does not reauthorize a submission. A successor
requires actual settled/no-effect evidence where the owning contract permits it,
current authority, bounds and normal admission; user no-retry/denied-operation
holds remain binding. This draft supplies no settlement collector or original
writer receipt and resolves none of the programme's existing uncertain reviews.

## Qualification, privacy and redistribution

Follow [TAK-JSI §8.2 / JSI-PD-002](../../architecture/job-specific-intelligence.md#82-learning-and-adaptation).
Preserve original scheme/version, subject/profile fingerprint, assessor, evidence
scope/status/validity and disclosure restrictions. A different Cursor composition
must undergo actual target assessment or an attributable scheme-defined
equivalence decision. A portable definition can support a defined claim when its
scheme permits; import or simulated examples cannot make it assessed/qualified.
GAID identity, JSI status and current effect authority remain separate.

Use BI07's positive source allow-list and per-file license/restriction inventory.
Do not include bearer tokens, private host paths/URLs, accounts, grants, memory,
organization/customer data, conversations or live approval/receipt bodies. Scan
filenames, resource closure, optional data and indirect references as well as
primary definitions. Existing source access is not redistribution permission.
Copy permitted reference material only; retain lawful versioned references where
content cannot be included. A required inaccessible source holds the relevant
semantic check and downstream claim. No license commitment or publication is
made by choosing a proposed representation.

## Verification design and completion boundary

All following observations are **UNRUN**, including the nine reused runtime cases.
They are candidate verification work, not frozen universal normative tests.

| Verification | Scope and observation required |
|---|---|
| CUR-V01 | Deterministic content mapping, exact source/output hashes, hostile package/unknown-version refusal, bounded loss reporting and inert staging; no live Cursor required. |
| CUR-V02 | Allowed/prohibited/ambiguous actions remain distinct with no effect while required approval is missing. |
| CUR-V03 | Hook absent/crash/timeout/malformed output and early/late coverage cases preserve required holds. |
| CUR-V04 | Arguments, principal, target/account, policy or profile mutation invalidates affected decisions before use. |
| CUR-V05 | Each reachable alternative effect path and delegated surface is inside proven mandatory mediation or unavailable. |
| CUR-V06 | Lost transport after acceptance retains original identity; original-writer/target evidence settles before permitted replay. |
| CUR-V07 | Parent exit with surviving descendants and late effects cannot manufacture closure or free ownership. |
| CUR-V08 | Authority expiry/revocation or changed host/configuration invalidates the affected admission/claim. |
| CUR-V09 | Package update/restoration preserves exact dependency/restriction deltas and does not compensate remote effects. |
| CUR-V10 | Disagreement, missing events, truncation/redaction or output transformation remains visible unknown; target evidence stays attributable. |
| CUR-V11 | Exact JSI transfer/equivalence, secret/private-data and per-component redistribution checks bind the selected destination/content. |
| CUR-V12 | PC-01–08 / CT-01–08 source traceability remains distinct from author runtime observations and independent reproduction; named-profile claims require all applicable mandatory observations. |

Use independently trusted F958 functions for synthetic fixtures; never execute
archive-supplied JS merely because its hashes agree. A self-consistent malicious
archive may replace code and hash claims together. Shared contract tests are not
proof of a host's effect mediation, and runtime evidence from one surface is not
portable to another without the owning equivalence decision.

Before implementation: complete normal design/research/architecture/approval and
scope-baseline process; obtain a concrete plan, live BI coverage, dependency
disposition and scoped implementation admission. Before runtime assessment: have
the actual BI07 release, normal target access/authority and an admitted test
environment, then name the observed composition. No live build/provider probe is
needed to review this design. Source Markdown checks establish draft quality only.

Completion requires the actual named Cursor reproduction and genuine acceptance
evidence against the item's baseline, including unsupported mandatory holds and
portable evidence/mapping. It does not complete Hermes, the DPF specimen, the
package itself, independent external reproduction or the wider programme.

## Risks and rollback

The primary risk is a false enforcement claim from successful content discovery.
Keep content mapping, structural validation, observed mediation and qualification
as distinct facts. Default changes, a host-specific variable, a missing hook or
an alternate subprocess path can invalidate an earlier observation. Rebuild and
reassess affected mappings; do not silently widen the profile or add a permissive
fallback to keep a demonstration running.

Rollback of this design is a normal source revert. Future implementation rollback
removes only explicitly generated staging/configuration owned by that admitted
change, preserves local user edits/grants and retains original evidence/identity.
Restoring source or disabling an adapter never settles previous external effects.
No runtime change, data migration, account or irreversible action is introduced
by this draft.
