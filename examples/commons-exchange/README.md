# Commons exchange working subset

Maintenance owner: @markdbodman. BI-0D316824 / WC-13E26FCD. Apache-2.0; retain LICENSE and NOTICE when copying. The joined source checkpoint and subsequent publication preparation are recorded in `examples/REUSABLE-COMPONENTS.md`; `closure.json.sourceBaseline` identifies the starting tree, not the completed revision.

## Contract and ownership

`@dpf/validators/commons` is the portable entry. Its exact source closure is in `closure.json`: finding plans/outcomes, result-only projection/intake, legacy sorted JSON hashing through a digest port, known-failure retry planning with supplied time, and bounded `commons-candidate/0.1` / `commons-review/0.1` assessment types. The portable closure has no third-party runtime dependency. It needs standard ES2022 and `TextEncoder`. `@dpf/validators/commons/node` adds the existing SHA-256 implementation using `node:crypto` and the legacy host retry default clock. Importing the core entry never imports that Node adapter.

Private candidates retain source references and separate accountable, requester, author and reviewer principals. Exact review binds candidate revision, decision scope, payload hash, destination identity/version and policy generation. The trusted host must resolve the canonical immutable full candidate/revision, including its provenance and principals, and the exact independently authorized human review before trusting the assessment. The assessment alone cannot detect same-revision drift in private fields, provenance or principals; the host must reject that drift atomically before reservation. `assessCommonsEgress` returns a proposal to the canonical command owner; `prepare-egress` is not an execution grant. Revoked/unknown authority, absent or expired review, changed bytes/destination, private/mixed classification, cancellation and reserved/uncertain/delivered effects all hold. Only authenticated host facts can make these decisions meaningful. Inbound `bundle.review` remains untrusted content.

`assessCommonsReceipt` classifies ledger observations: reservation, uncertain effect, delivered receipt and independent acceptance are distinct. Exact duplicates are no-ops; changed binding/remote receipt and premature acceptance hold. A host owns atomic reservation, current TAK revalidation, durable compare-and-swap, transport, lost-ack reconciliation and acceptance provenance. Never put private candidate/source references or its binding material in a public body. Only the authorized, reviewed result projection is outbound. Field-name filtering does not prove that text contains no private information.

## Real DPF consumers and retirement

The existing finding-contribution store now imports the portable finding rules. Its displaced app implementation is deleted. The existing Hive result store imports the portable Node intake/retry adapter; its displaced app intake implementation is deleted. Result projection moved out of the build egress classifier; the classifier retains the actual forge URL parser and DPF target policy. Tests import the canonical package entry. No new ledger, approval store, orchestration engine or transport was introduced.

The real contribution pack marks each newly prepared current payload local, including an existing pack retry, and records `contributed` only with that attempt's actual PR receipt. Finding contribution status likewise changes only after a PR receipt; failures still reach build reconciliation. No historical production rows were rewritten. Contribution means transport receipt, not upstream acceptance or safe installation. Historical FeaturePack review metadata is not a version-bound approval for a rewritten payload; complete exact-review persistence remains unavailable.

Existing ledger source-receipt duplicate/conflict behavior and persisted `sha256:` result hashes remain under the same host store. Numeric-key, UTF-8 and nested prototype-key literals pin existing bytes. Intake intentionally adds bounded-JSON rejection before recursive traversal (cycles, accessors, unsupported prototypes, non-finite values); it no longer hashes non-JSON values that cannot arrive as valid HTTP JSON. Nested `__proto__` keys are still traversed for violations and omitted from serialized own keys, preserving issued projection bytes while removing the legacy prototype mutation. The closed serializer guard relocates its one existing legacy exception rather than adding another hash implementation.

## Proof and DPF2 adoption

Run `node examples/commons-exchange/run.mjs` with exact Node 24.16.0 available (or set `COMMONS_EXCHANGE_NODE24` to it). The runner uses TypeScript 6.0.3 from managed dependencies, copies only the declared seven-file closure to a temporary directory, verifies relative imports, compiles strict NodeNext with no ambient Node types, injects a real Node SHA-256 digest port, runs six synthetic groups, prints every copied source hash and removes the temporary consumer. It never starts DPF, uses producer module links or reads a company corpus. The optional Node adapter is separately exercised through the actual app tests.

Before DPF2 consumes the helper, its existing candidate/review/Store owner must
bind each company/candidate/revision to one immutable complete private candidate,
including ordered source references and every principal/provenance field. Store
a private full-candidate identity using its existing versioned canonicalization,
separate from outbound `payloadHash`. Independent review resolves those exact
bytes from storage; reservation checks current review and rejects drift atomically.
The `/0.1` assessment does not establish this custody. Legacy unbound candidates
stay private/held pending reconstruction and review; never backfill approval by
hashing current content or silently add a digest to strict `/0.1` objects.

DPF2 can then absorb the selected closure as one internal module, keep one digest adapter and retire any displaced local candidate projection/intake serializer only after comparing its issued bytes and receipt semantics. Supply DPF2's existing Workroom, review, TAK, trusted clock, ledger and transport owners; do not copy DPF Prisma or build code. The candidate `sourceRefs` allow Workroom/finding/result references, but do not make DPF's existing FeatureBuild-only ship tool handle them. Copied source requires ownership of future upstream fixes, regression vectors, limits and license notices; importing the private workspace package is the alternative if both projects share a managed source boundary.

Unavailable: durable production exact-content/destination approval, exactly-once egress, full curation and governed adoption, standards conformance, authenticated real review and DPF2 acceptance. This module exposes no adoption or execution command; those require the owning host adapters and gates. The standalone receipt sequence is synthetic and does not exercise adoption or claim live enforcement. Native plan/review gates, served runtime and shared build were unrun at the recorded local checkpoint. Current publication verification belongs to the branch's pull request. No release or production business data change is authorized by this extraction.

## Migration and rollback

Move the package closure and caller imports together. Do not recompute stored hashes, change opaque source receipts or reinterpret submitted/accepted/delivered axes. Keep the legacy adapter for current issued records and use a new version for any future canonicalization change. Revert this slice and its imports together for rollback; no schema, runtime, credential or infrastructure rollback is required.
