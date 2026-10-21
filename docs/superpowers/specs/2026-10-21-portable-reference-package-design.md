---
status: draft
---

# Portable coworker reference package: assembly and inspection

**Backlog:** BI-07A2B207 · **Epic:** EP-B932453F · **Workroom:** WC-B99B353A
**Delivery:** delivery-large@1.0.0; design phase only.
**Source inspected:** `ee1e80b0a46b893beea11b928cfe621849730ad4`, 21 October 2026 UTC.

This design makes the existing portable contracts usable outside the DPF source
checkout. A recipient can inspect a versioned package, verify its contents, and
run its synthetic reference examples without DPF credentials, a database, a model
provider, or a mandatory publisher service. Inspection does not install a coworker,
connect tools, activate schedules, transfer authority, or qualify a runtime.

This is a proposed package-assembly and validation design. It has no independent
design approval, objective baseline, implementation-plan coverage, native semantic
verdict, publication permission, or runtime qualification. No exporter or adapter
is implemented by this document.

## Scope and existing owners

[The portable contract design](2026-09-27-portable-tak-contracts-design.md) and
[consumer contract](../../architecture/trusted-agent-reference-contract.md) belong
to BI-F9582C48. They already own five strict artifacts, JSON Schema generation,
semantic import, the pure decision loop, and simulated examples. BI-07A2B207 owns
assembly, standalone distribution and package-level validation; it must reuse
those implementations rather than fork them. The current `@dpf/validators`
workspace package is private, exposes TypeScript source, and depends on the
workspace's pinned Zod version. Its presence alone is not a standalone release.

| Canonical source | Package use | Boundary |
|---|---|---|
| `apps/web/lib/coworker-lifecycle/coworker-definition.ts` | Reuse its assembled `CoworkerDefinition` view and source provenance to describe composition requirements. | It is a pure assembled view, not a database model or a new export database. Its grant names describe requirements, never imported live grants. |
| `packages/db/data/agent_registry.json` and the sources injected into that view | Resolve selected, allow-listed definition fields at the pinned source revision. | The registry mirror is not evidence of a current installation's authority. Do not copy the whole registry, model credential references, rosters, or self-task configuration. |
| `packages/dpf-skill-pack/skills/` | Include only selected redistributable skill instructions and their explicit resource closure. | Preserve each source path, version and digest. No unrelated skills, recursive directory dump, or automatic instruction execution. |
| `packages/validators/src/trusted-agent-contracts.ts` | Generate structural schema and reuse `importTrustedArtifact` for semantic checks. | Structural schema is not semantic validation, provenance verification, authorization or conformance. |
| `packages/validators/src/trusted-agent-reference-loop.ts` and `trusted-agent-examples.ts` | Include the supported pure reference module and its explicitly simulated examples. | No new effect dispatcher, scheduler, receipt store or alternative retry policy. |
| `apps/web/lib/work-management/work-shapes.ts`, archetype definitions and the canonical Workroom model | Derive the selected versioned activity/room requirements and participant-role references. | Preserve definition versus instance. Unsupported parallel or token flow must be reported rather than flattened into the existing sequential contract. |
| [TAK](../../architecture/trusted-ai-kernel.md), [GAID](../../architecture/GAID.md), [TAK-JSI](../../architecture/job-specific-intelligence.md), [GPP](../../architecture/gated-permissions-process.md) | Carry versioned normative references and permitted source snapshots. | These documents remain the semantic owners; no package-specific replacement standards, authority vocabulary or qualification scheme. |

The implementation dependencies in the item body remain BI-F9582C48,
BI-2AB781FA and BI-F3C2EC7A. Source contract availability supports this design; it
does not establish that the conformance denominator, DPF specimen, adapters or
runtime evidence are complete. Hermes BI-FEA232AF and Cursor BI-0E56BA38 retain
their own implementation and assessment scope. No target or operating profile is
selected here.

## Objectives and observable acceptance

**OBJ-PKG-001:** Derive one reproducible package from canonical, immutable source definitions without establishing a second editable definition store.

**OBJ-PKG-002:** Let an unauthenticated recipient safely inspect and validate package structure, integrity, dependencies and declared limitations offline before any activation.

**OBJ-PKG-003:** Preserve identity, qualification, authority, evidence and redistribution boundaries across distribution, import and update.

**OBJ-PKG-004:** Provide reproducible synthetic reference scenarios and explicit traceability to the existing contract tests while leaving target runtime assessment unclaimed.

| Acceptance | Objectives | Requirement | Proposed evidence |
|---|---|---|---|
| AC-PKG-001 | OBJ-PKG-001 | Two assemblies from the same pinned sources, generator version, parameters and dependency lock produce the same content inventory and payload bytes; a source change changes the relevant digest. | Reproducibility and tamper fixtures. |
| AC-PKG-002 | OBJ-PKG-001 | Every payload entry identifies its canonical source, immutable revision, source digest, derivation and exact output digest; generated outputs are rebuilt from their owners rather than edited directly. | Full source-to-output inventory reconciliation. |
| AC-PKG-003 | OBJ-PKG-002 | A clean documented environment validates and inspects the delivered package without a DPF account, network access, publisher service or repository checkout; missing prerequisites produce a bounded diagnostic. | Network-denied clean-environment inspection. |
| AC-PKG-004 | OBJ-PKG-002 | Malformed, oversized, ambiguous, path-escaping, link-bearing or integrity-invalid archives are rejected before extraction or loading executable content. | Hostile package fixtures and filesystem observation. |
| AC-PKG-005 | OBJ-PKG-002, OBJ-PKG-003 | Unsupported required versions, extensions, dependency semantics, flow semantics or mandatory controls hold import; optional unknown data round-trips within bounds and supplies no authority. | Negative import and round-trip fixtures. |
| AC-PKG-006 | OBJ-PKG-002, OBJ-PKG-003 | Inspection and import create no actors, grants, credentials, tool connections, schedules, persistent agent memory or external effects; activation requires a separate target-owned admission. | Before/after local-state and external-effect observations. |
| AC-PKG-007 | OBJ-PKG-003 | Selected content passes allow-list, secret/private-data and redistribution review; every included file has an attributable license disposition and required notice, while prohibited or unresolved content is excluded or holds assembly. | Content review, scanner results and complete license inventory. |
| AC-PKG-008 | OBJ-PKG-003 | Original qualification status and evidence scope remain attributable to the original subject/profile; a new target is not assessed or qualified without target assessment or an attributable scheme-defined equivalence decision. | Transfer, changed-profile and stale-status fixtures. |
| AC-PKG-009 | OBJ-PKG-003 | Updates produce a new immutable package and report changes to requirements, restrictions, dependencies and evidence; they neither overwrite local grants nor treat file restoration as external-effect settlement. | Update and rollback fixtures. |
| AC-PKG-010 | OBJ-PKG-004 | Synthetic success, refusal, scope mismatch, uncertainty/reconciliation and extension-negotiation examples run through the existing reference functions and label every generated observation simulated with conformanceClaim none. | Standalone example output reconciled to canonical examples. |
| AC-PKG-011 | OBJ-PKG-004 | The package distinguishes included evidence from references requiring authenticated resolution, reports inaccessible evidence unknown, and maps each claim to an exact version, scope, assessor and observation or states it unassessed. | Missing-reference and conflicting-evidence fixtures. |
| AC-PKG-012 | OBJ-PKG-001, OBJ-PKG-004 | The release maps its selected content to PC-01–08 and CT-01–08 without claiming those source tests or the nine candidate runtime cases establish the target's conformance. | Traceability review and complete declared test ledger. |

All proposed acceptance evidence above is unrun for this package. Approval of
this design must not be recorded as acceptance of those observations.

## Research & Benchmarking

The completed *Hermes Agent and Cursor portability research*, 20 October 2026,
compares eight control areas using 25 official sources. Its retained report digest
is `sha256:783ee1436f2e7ed53fff95952272323b3a1d2943a711b131295706fd93962154`;
the source register digest is
`sha256:cca229362ac2dd42eb3c6d67c973892a5fb27472fe245911f68183da450e876d`.
Canonical manual-check activity `cmvgttebn89ie01ldiv74h198` on this item records
that documentation contribution. This design reuses it; it does not reinterpret
the nine unrun candidate runtime cases as passing reproductions.

Adopt [Agent Skills](https://agentskills.io/specification) for transferable
instructions/resources and retain [MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
tool contracts where supported. An experimental `allowed-tools` field, server
name or `readOnlyHint` is not an authority boundary. A content carrier cannot
replace the existing TAK authorization and GPP mediation contracts.

Official package-format documentation checked on 21 October 2026 supplies the
following data-model comparison. It is documentation evidence, not observation
of an installed host. Commercial formats are compared as potential projections;
this design selects no executing host.

| Comparator | Concrete model | Adopt or preserve | Reject or report as a loss |
|---|---|---|---|
| [Agent Skills](https://agentskills.io/specification) | Required `name`/`description`; optional `license`, `compatibility`, `metadata`; instructions and resource directories. | Reuse the instruction/resource layout and declared compatibility. | Do not treat experimental `allowed-tools` as grants or infer lock, provenance or control coverage from skill discovery. |
| [Agent Plugins 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md) | Root `plugin.json` with `$schema`/`name`, optional version/repository/license/extensions; fixed skills and MCP components. | Consider a generated host binding for supported content. Preserve the original package inventory outside the host's permissive loader. | Clients may support only skills or MCP and ignore unsupported component types/namespaces. Those behaviors cannot satisfy a mandatory TAK requirement. Summary-page differences about malformed extensions require checking the pinned normative spec before implementing a binding. |
| [OCI manifest](https://specs.opencontainers.org/image-spec/manifest/) and [descriptor](https://specs.opencontainers.org/image-spec/descriptor/) | `schemaVersion`, media/artifact type, config, layers, subject and annotations; descriptors carry media type, digest and size. | Reuse the separation of content identity, type and length when deriving the inventory. | Do not add an OCI registry or container runtime for this content package, or equate a digest with signer trust or semantic equivalence. |
| [Cursor plugins](https://cursor.com/docs/reference/plugins) | Native `.cursor-plugin/plugin.json` identity/version/repository/license, component paths, variables and schema; marketplace sources/version. | A future projection can map declared component paths and exact source identity. | Standard Agent Plugins support does not imply all substitutions: documented `PLUGIN_ROOT`/`PLUGIN_DATA` expansion is unsupported. Record that loss and hold any required mapping. Never copy dashboard secrets into source. |
| [Claude plugins](https://code.claude.com/docs/en/plugins-reference), [dependencies](https://code.claude.com/docs/en/plugins/dependencies) and [marketplace](https://code.claude.com/docs/en/plugins/marketplace-reference) | Identity/version/license, components, dependencies and `userConfig`; sensitive configuration has distinct storage; immutable Git/archive source pins differ from dependency ranges. | Preserve exact source pins and the separation of distributable definition from local sensitive configuration. | Unknown top-level fields may be stripped; package-required semantics cannot rely on their survival. A range or catalog entry is not immutable dependency identity. |
| [VS Code extension manifest](https://code.visualstudio.com/api/references/extension-manifest) | `package.json` name/version/publisher/`engines.vscode`, extension dependencies/pack/kind, license and repository. | Reuse explicit host compatibility and dependency relationships as comparison patterns. | An extension pack is not evidence of shared authority or qualification. [Marketplace signature checks](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security) do not establish that a private archive is signed or satisfies TAK. |

The [Agent Plugins manifest](https://agent-plugins.org/plugin-authors/manifest)
and [loading contract](https://agent-plugins.org/client-implementers/loading-and-discovery)
are useful implementation guides; pin the normative version for a binding rather
than guessing through disagreements. Resolve and report all host-format losses
before activation. No host-specific package is generated in this design phase.

For generated provenance, [SLSA 1.2 build provenance](https://slsa.dev/spec/v1.2/build-provenance)
provides subject, build definition, external parameters, resolved dependencies and
builder identity; producing those fields alone earns no SLSA assurance level.
[SPDX 2.3.1 package information](https://spdx.github.io/spdx-spec/v2.3.1/package-information/)
separates identity/version/checksum and declared versus concluded licensing.
Use these existing interchange patterns where the release evidence supports them;
neither an inventory nor a declaration determines redistribution permission.

The reuse path is clear: derive a bounded distribution from existing definitions
and validators. Forking those contracts would create another semantic owner;
copying an entire installation/profile would export instance state and active
configuration. Neither is suitable. A conventional inspectable content archive
and derived inventory address package-level provenance and disclosure without
pretending to be a universal host loader. External format mappings remain
projections of that inventory and must preserve unsupported semantics visibly.

## Assembly and content inventory

The future assembler reads an explicit selection at one full repository commit.
Its input records the composition/skill/work/archetype selectors, source document
versions, generator identity and dependency lock digest. No wildcard can silently
include new files or follow symlinks. A source change requires a new assembly.

The release contains a conventional directory/archive and a generated inventory:

| Content | Included information |
|---|---|
| Inventory and provenance | Package identity/version; inventory-format version; source repository/commit/tree; generator version; canonical input selectors and parameters; each normalized relative path, role, media type, length and SHA-256 digest; source path/blob/digest and derivation; restrictions and license disposition. |
| Contract artifacts | Structural schema generated by `trustedArtifactJsonSchema()`, selected portable definitions and exact existing semantic-import/reference-loop modules with their complete runtime dependency closure. |
| Skills and governing references | Allow-listed skill/resources; exact normative/profile/work-shape references; permitted source snapshots needed for offline interpretation; explicit reference-only entries for material that cannot be redistributed. |
| Synthetic scenarios | Existing simulated contract cases, a deterministic expected-output description and traceability to the owning tests. No live run history is packaged as a demonstration result. |
| Dependency and licensing material | Exact versions and artifact digests from the existing lockfile, runtime requirements, file/component license and notice inventory, source/provenance references and redistribution disposition. |
| Inspection guide | Required verifier/runtime versions, all limits, unsupported capabilities, example instructions, evidence scope, and the separation between inspection and activation. |

The inventory is a derived release artifact, not a second definition registry or
editable policy store. Keep envelope/inventory, output bytes and canonical source
digests separate. Use a deterministic inventory serialization; hash exact file
bytes without newline conversion. The root inventory digest is computed from its
canonical content excluding its own digest/proof fields. Record the final archive
digest separately. Archive ordering, timestamps, ownership metadata and compression
parameters are fixed by the assembler version, never host defaults.

Do not ship unresolved workspace `catalog:` dependency selectors: resolve the
exact pinned dependency versions and artifact digests for the selected release.
Include their license/notice closure and fail when a required artifact is absent.

An existing authenticated release/provenance mechanism may attest those digests.
A matching hash alone does not authenticate the producer, prove a scanner result,
or establish redistribution rights. This item adds no signing service or database
model. Where no acceptable origin proof exists, the inspection result states
origin unverified and forbids an authenticated-origin claim.

The clean inspection prerequisite is a supported standalone verifier and its
documented runtime, distributed with pinned dependencies and notices. It must not
require installing the DPF monorepo or execute its package-manager lifecycle
scripts. The implementation plan must choose a supported runtime and demonstrate
the dependency closure in AC-PKG-003. The current source package is not asserted
to satisfy that requirement already. No new service, subscription or mandatory
model dependency is proposed.

## Inspect first; activate only in the target's owning process

The recipient uses a trusted verifier obtained independently of the untrusted
archive. Do not execute an archive's own verifier, install script, imported plugin
or hook to decide whether that archive is safe. Every content item is initially
data, including skills, commands, MCP definitions, JSON schemas and examples.

1. Check the archive's declared format/version and trusted-origin information.
   Inventory claims remain untrusted until their corresponding checks succeed.
2. Enforce archive limits before extraction: at most 256 entries, 64 MiB compressed,
   128 MiB total expanded and 16 MiB per entry for the first package version.
   These are proposed defensive ceilings, not measured capacity claims. Reject
   excess rather than truncate; nested archives are unsupported.
3. Reject absolute paths, parent traversal, NULs, duplicate/case-colliding or
   normalization-colliding paths, symlinks, hardlinks, device entries and undeclared
   files. Extraction stays within a new temporary directory and cannot replace
   an existing host configuration. A failed validation leaves no active state.
4. Reconcile every entry's length/digest/media role against the complete inventory
   and verify the exact dependency closure, licenses and required notices. Do not
   fetch missing packages, follow remote schema references or resolve private URLs
   automatically. Missing dependencies are explicit failures.
5. Apply the existing semantic importer to every supported trusted artifact.
   Preserve its exact-version negotiation, bounded JSON and error limits. Check
   package-wide reference closure and source/version consistency separately;
   structural JSON Schema cannot prove these cross-artifact properties.
6. Produce a local inspection report with package digest, verifier version,
   check results and limitations. Each capability is declared, supported by a
   named implementation, assessed by stated evidence, or unknown/unsupported.
   Package validation success is not a permission token or qualification badge.

Inspection never creates a Principal, issues a GAID, imports authority grants,
starts a model, connects MCP, enables a schedule or invokes tool hooks. A later
target activation resolves current actors, grants, endpoint identities, policy,
data handling and human roles through that target's existing governed process.
Static tool requirements name contract identifiers/versions without credentials,
account IDs, installation endpoints or executable connection configuration.

Unknown mandatory extensions require the existing exact-version semantic
validator and fail closed when unavailable. Known names with unsupported versions
also fail. Optional unknown data is retained unchanged within bounds, never loaded
as executable policy. Required control semantics without a target mapping hold
activation; successful import of prose is not a substitute. Unsupported sequential
projection, parallel flow or GPP binding behavior must remain explicit limitations.

## Identity, JSI transfer and evidence

Definition identity is distinct from an installed subject and its operating
profile. A recipient may reuse a definition; it does not inherit the publisher's
Principal, private GAID, namespace, keys, grants, memory or customer identity.
Public identity/assurance references may be included only under the source's
disclosure policy. Source references cannot expose private identifiers merely
because their payload has been removed.

[TAK-JSI §8.2 and JSI-PD-002](../../architecture/job-specific-intelligence.md#82-learning-and-adaptation)
retain the original evidence scope and require target-profile assessment or an
attributable, scheme-defined equivalence decision. Carry the original scheme,
version, subject/profile fingerprint, assessor, scope, status and validity period
only where disclosure permits. Report unresolved current status as unknown.
Changing model, provider, tool surface, corpus, memory, work shape, policy or
oversight cannot silently preserve the original qualification claim.

An imported definition can support the defined level when the relevant scheme's
requirements are met. It cannot become assessed or qualified through package
inspection. GAID claims, JSI evidence and live TAK authorization remain different
objects. A historical receipt or synthetic example never authorizes a new effect.

Evidence entries distinguish included sanitized bytes from authenticated
resolution references. For each claim retain evidence provenance, subject,
observation time, exact assessed composition, applicable scope and unresolved
limits. Missing, inaccessible, redacted, truncated or conflicting evidence is
reported rather than replaced with a digest, summary or fabricated pass. No
package import settles an uncertain external effect or supplies a missing original
writer receipt.

## Privacy and redistribution

Use a positive content/field allow-list before copying. Exclude credentials and
credential references, private host paths/URLs, instance grants, organization or
customer data, user memory, conversation logs, task transcripts, approval
envelopes, live receipts and private identity mappings. Test filenames, resources,
optional extension payloads and indirect references as well as primary JSON.
Synthetic records must be generated examples and clearly labeled; do not assume
that replacing a person's name anonymizes a real record.

Pin a selected source's restrictions and redistribution disposition. Missing
source permission, ambiguous third-party licensing or an unresolved destination
restriction holds inclusion. The repository and validators declare Apache-2.0;
that is not a blanket determination for every linked document, image, dependency,
standard or private source. Record required notices and any applicable separate
terms per included component. Refer to restricted standards by version and lawful
link rather than copying their text. Public publication, new license commitments,
legal judgments and outreach remain outside this design action.

Review/scanner findings bind the exact content inventory, tool/ruleset versions
and destination. Scan success does not establish rights or origin. A later changed
inventory invalidates the affected result. Existing source access and document
retention mechanisms remain authoritative; the package does not create a new
retention worker, evidence ledger or exemption.

## Updates, verification and delivery boundary

Every update is a new immutable package with explicit compatibility declarations
for inventory, artifact, skill, work-shape, normative, dependency and target-format
versions. Reject unknown required meanings rather than coercing them. The
comparison reports added/removed requirements, narrowed/widened restrictions,
evidence and dependency changes. Mutable `latest` references do not pin a release.

Revalidation precedes activation. No update overwrites target grants, credentials
or local policy; changed instructions/hooks are untrusted input until admitted.
Restoring old package files can restore source bytes only. It cannot reverse a
message, payment, queue mutation or other external effect; uncertain prior work
retains its original identity and reconciliation obligation.

The implementation plan must map AC-PKG-001–012 to the existing item's deliverables
and normal independent design, plan and coverage receipts before implementation.
The smallest implementation slice is one deterministic assembly plus one offline
inspector and synthetic test package; release publication and runtime activation
remain later gated actions. Reuse existing build tooling and dependency versions;
do not introduce a package registry service, exporter database or host policy engine.

Reuse PC-01–08 and CT-01–08 as source-contract traceability, preserving their
actual outcomes and source identity. Add package observations for reproducibility,
hostile archives, dependency/license closure, secret/private-data exclusion,
unsupported controls, unknown evidence, JSI transfer and update behavior. The
existing nine research cases remain candidate runtime assessments: allowed/denied
actions; hook failure; argument mutation; alternative effect paths; lost transport;
surviving descendants; authority/configuration change; update/restoration; and
evidence disagreement. All are unrun for Hermes/Cursor and this package.

This draft changes no API, schema, migration, install path, host default or live
deployment contract. It refers to canonical Organization/Principal identity and
the existing definitions, document artifacts and evidence carriers. No second
policy or normative store is introduced. Local source/document checks establish
only draft quality; independent review, package tests, redistribution acceptance,
publication and target runtime verification remain outstanding.
