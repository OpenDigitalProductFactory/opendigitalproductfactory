# Operating composition: OP-01 local consumer

`@dpf/validators/operating-composition` provides a bounded composition record and
an assessment of supplied current qualification facts. It does not authenticate
those facts, qualify a model, admit execution, or grant authority.

The migrated real DPF caller is `apps/web/lib/identity/aidoc-resolver.ts`.
Its `operating_profile_fingerprint` remains the existing unversioned SHA-256
hexadecimal field used by UserFact, semantic recall, identity snapshots and agent
cards. Its material and JSON.stringify sorted-key serialization are extracted
without changing bytes. `routing/metadata-hash.ts` remains the real Node SHA-256
adapter used by provider metadata and AIDoc. The old app material builder and
serializer are removed; no duplicate scoring, profile store or hash engine is
introduced. Existing stored values need no backfill.

The legacy fingerprint covers model settings, prompt-class labels, grants,
default human-review tier and sensitivity. It omits effective prompt/skill bytes,
doctrine, supervision/delegation details, memory policy and harness identity.
The new `operating-composition/0.1` reference is separate and must never be
compared to a stored legacy fingerprint as though it were the same algorithm.

## Contract and owners

`buildOperatingComposition(value, digest)` requires exact version/digest refs for
subject, principal, job, role, supervision, effective instructions, skills,
models, tools, owning doctrine, memory policy, configuration, harness and runtime.
Instructions are ordered; skill/model/tool sets and doctrine scopes are sorted
deterministically. Duplicate identities, unknown fields, missing refs, unsupported
versions, excessive collections and hostile JSON hold. The supplied digest port
must return lowercase SHA-256 hex. New records use the existing shared
`canonicalJson` source, identified here as `dpf-canonical-json/v1`, not a claim of
RFC 8785 conformance.

These refs use the existing trusted-agent reference fields, requiring digests for
this new record. The resulting ref may populate the strict 0.1.0 operating-profile
envelope's existing `composition` field. This does not add fields to that
envelope, prove effective source completeness, or upgrade its schema implicitly.

`queryOperatingQualification(composition, {schemeRef, now}, ports)` recomputes the
composition, reads current composition and qualification facts, checks exact
subject/principal/composition/scheme/harness/runtime, evidence and validity, then
reads current composition again. Every query, including replay, performs these
reads. Missing, revoked, failed, stale, unsupported or throwing facts hold. The
result's authority is always `assessment-only`. Current host facts are an input
claim; their authentication, provenance and scheme semantics belong to the host.
The query is not an atomic authorization transaction and caches no admission.

DPF keeps these existing owners:

- PromptTemplate/Revision and prompt loading overrides/cache/fallback/includes;
  instruction/data provenance and actual ordered prompt assembly.
- AgentSkillAssignment and SkillDefinition/Assignment/Revision, which are distinct
  sources; real tool operation contracts, model policy and routing/residency.
- Agent, GovernanceProfile, ExecutionConfig, ModelConfig, canonical grant owner,
  revocations, delegation, human decisions and current authority intersections.
- Governed memory, actual assessment schemes, authenticated reviewer identity,
  source lineage, receipt persistence, budgets/capacity and effect transactions.

Active AIDoc validation_state, eight-day coworker certification and coordinator
absent-scheme `not-applicable` remain their existing separate concepts. They do
not satisfy exact-composition qualification. Existing missing-AIDoc advisory
memory fallback is preserved, not counted as a new fail-closed qualification path.

## Standalone proof

Run `run-isolated.mjs` with Node 24.16.0, optionally selected through
`OPERATING_COMPOSITION_NODE24`. It verifies the exact Node/TypeScript 6.0.3 versions,
copies the seven-source closure listed in `source-manifest.json` byte for byte
into a temporary project, and prints hashes of the copied bytes. Compilation uses
strict NodeNext, ES2022, types=[], no application aliases, ambient Node declarations
or dependency links. The shared canonical JSON leaf is the only internal package
source copied; its parent package's undici runtime is absent. No third-party
runtime dependency is used. The compiler is a separately pinned external build tool.
LICENSE and NOTICE accompany the closure. The lock describes this copied local
distribution, not an instruction to fetch the internal package from a registry.

The synthetic fixture uses one bounded host owner and a local receipt map. It
exercises author/reviewer composition, exact source/actor/result binding, failure,
missing persistence, lost acknowledgment, exact replay, conflicting content,
verdict or attempt, revocation on replay, source/profile changes, capacity wait,
cancellation and deadlines. Issued packets and submitted results are snapshots.
An unknown acknowledgment stays unknown until an exact stored receipt is found;
a failed judgment remains failed even when its receipt cannot be stored.

This is a sample adapter, not production authentication or review qualification.
It performs no real model call, routing, tool execution, approval, delegation,
receipt submission or business write. Production must authenticate source/fact
owners and atomically check current authority, context and evidence when storing
receipts or effects. Full software author/reviewer execution with a permitted
qualified alternative, routing, quotas, cost/cache semantics, cleanup and real
runtime/harness qualification remain unqualified here.

## Absorption and retirement

The pre-extraction source baseline is `4fa796b64425b6129f172a01b89d8c8887c065fc`,
containing the previously frozen WK/GP/SJ components. The independently reviewed
OP commit is supplied with the handoff; the runner prints exact fingerprints of
the source bytes it copies. The manifest does not invent a self-referential final SHA.

A consumer should pin that reviewed producer revision, retain notices, and adapt
its current profile/reference owners. Reuse the pure computation while keeping
identity, source resolution, effective prompt assembly, authority and storage in
the consumer. Retire the displaced legacy material/serializer computation only
after literal/parity and stored-record compatibility tests. Never replace a
legacy stored hash with the new composition digest without a separately tested
record migration. No DPF2 files or host responsibilities were changed by this slice.
