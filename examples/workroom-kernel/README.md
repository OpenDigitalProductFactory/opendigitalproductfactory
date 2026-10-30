# Isolated Workroom kernel consumer

This executable example consumes the extracted graph, marking and receipt kernel
without starting DPF or modifying DPF2. It is one synthetic test adapter with two
fixed fixtures, not a second supported coordinator, authority service or practice
catalog. It performs no shell, model, customer, deployment or physical effects.

The kernel owns token progression and bounded graph rework. `src/host.ts` supplies
one in-memory transaction, fixture principals, current profile/binding references,
owner decisions and observed artifact/input facts. Those are deliberately host
responsibilities. DPF2 must retain its protected artifact/lineage validation,
admission/permit checks and Store transaction owner; this sample supplies none of
their production authentication or security guarantees.

## Reproduce the isolated build and smoke

From a checkout containing the source closure and its managed development
dependencies, the verification entry is:

```sh
node examples/workroom-kernel/run.mjs
```

The invoking Node executable must be **24.16.0**. `WORKROOM_NODE24` may select
another installed executable of that exact version. The compiler is the existing
managed TypeScript **6.0.3** installation; it is a build tool, not a runtime
dependency. No install, download or package-manager operation occurs in the run.

`run.mjs` copies only `closure.json`'s nine producer source files, this sample's
sources and `tsconfig.json` into a fresh directory outside the repository. It writes
a standalone ESM manifest and lock with zero runtime dependencies, clears
`NODE_PATH`, compiles with `module`/`moduleResolution: NodeNext`, `types: []` and
`lib: ["ES2022"]`, then executes the emitted JavaScript under Node 24. It rejects
non-relative/non-`.js` kernel imports and copies regular source files rather than
dependency symlinks. No application alias, workspace-wide TypeScript configuration
or producer runtime package is available to the consumer. The temporary directory
is removed after success or failure.

The output names passing scenario groups and records SHA-256 digests of the exact
copied producer files. Those digests describe the tested working source bytes;
the containing delivery's exact commit must be supplied separately. This README
does not invent a future commit identity.

## Supported synthetic contract

`src/practices.ts` carries two bounded definition descriptors:

- Customer report: inspect → draft → independent verification → owner acceptance.
- Enabling improvement: plan → implement → independent verification → owner release.

Customer drafting depends on the accepted improvement's release artifact. A
review refusal uses the extracted rework edge and invalidates the old iteration.
Exhausting that edge yields a hold; it never satisfies the customer prerequisite.
Each fixture allows at most two cycles. Source, skills/corpus, JSI, runtime and
real outcome gaps are explicitly listed in the descriptors.

The thirteen executed scenario groups cover:

- Paired normal progression and the cross-room dependency hold.
- Exact definition, room, run/cycle, stage/iteration, attempt, actor, profile and
  binding identities; missing/unknown receipt kind; denial without partial state.
- An actual fixture-owner decision for human-required work; reviewer identity
  cannot impersonate that owner.
- Rework and refusal to reuse the old iteration's evidence.
- Restart after a lost acknowledgment, identical replay, changed-payload conflict
  and current revocation before replay.
- Pending/uncertain attempt holds; retry requires an explicit synthetic target
  observation of no effect and a distinct attempt.
- Protected artifact bytes and transitive inputs revalidated after restoration.
- New-cycle evidence, stale pinned definitions and changed profile/binding versions.
- Exact prerequisite references and malformed stored marking refusal.
- Revocation while an attempt is pending.
- Bounded rework exhaustion remaining held rather than accepted.
- Human checkpoints bound to the exact content, verdict, input references and
  attempt; changed content or a distinct retry requires a fresh bounded decision.
- Recursive prerequisite revocation at both begin and completion, preserving the
  historical effect records while withholding their use as current evidence.

Contexts represent principals already authenticated by the test harness. Artifact
content snapshots and attempt records model a protected store's equality checks;
they are not signed portable attestations. A caller supplying these objects over
an HTTP endpoint would not create authentication or authority. State restoration
is JSON copying for deterministic recovery tests, not a qualified database.

The sample uses fixed trusted time and fixture-only admission. It does not qualify
expiry, network/process containment, concurrent writers, cancellation of actual
effects, local/cloud routing, corpus handling, general actor/session capability
aggregation, JSI, a production GPP enforcer or a real customer/self-release loop.
The incumbent kernel's legacy wildcard run/kind behavior is preserved; this host
checks exact evidence before projecting its receipts. Forward graph edges into
failure/budget stops remain unsupported by the extracted marking implementation.

## Source, notices and absorption

Producer source derives from DPF baseline
`e22a9996c58a21e6af868baa0f48ee2195573bc2` and this local extraction. `closure.json`
is the complete runtime source manifest. Original source comments remain in those
files. `LICENSE` and `NOTICE` preserve the repository's license and attribution
notice; the runner carries both into the temporary consumer.
No third-party runtime source is vendored by this example. This is provenance
documentation, not a complete rights or supply-chain audit.

Absorb the manifested pure kernel behind the consumer's current core adapters only
after its unchanged command/experience acceptance passes. Retire only structural
calculations actually replaced. Keep company facts, trusted evidence/authority,
transactions, scheduling and executor qualification with their canonical owners.
The producer's public entry is `packages/validators/src/workroom/index.ts`; browser
consumers must use that narrow entry rather than an unrelated package root barrel.

The platform maintainer owns the kernel and this conformance example. Upgrades
must retain the source manifest, compare exact definition/receipt serialization,
rerun the isolated suite and migrate callers together. Revert the extraction and
its actual caller changes as one slice. No schema migration, issued identity,
production record, service, image, credential or subscription is changed here.
