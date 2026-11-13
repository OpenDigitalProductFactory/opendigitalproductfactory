# Scoped judgment consumer

This synthetic consumer exercises the extracted DPF scoring functions and the
new `scoped-advice/0.1` boundary through `judgment/index.ts`. It contains no
private WWMD, WWWD or WSID doctrine. It is a sample host adapter, not production
qualification or an authenticated decision service.

Run `node examples/scoped-judgment/run.mjs` with Node **24.16.0**. The runner uses
its own Node executable by default; `SCOPED_JUDGMENT_NODE24` may select another
executable with that exact version. It checks the repository compiler is
TypeScript **6.0.3** before using it as an external build tool.

The runner copies exactly the eight files in `closure.json`, this fixture and
its compiler configuration into a temporary directory outside the checkout.
It creates an ESM package manifest and empty dependency lock, compiles strict
NodeNext with `types: []` and `lib: ["ES2022"]`, then executes the emitted
JavaScript. It supplies no application paths, dependency symlinks or external
runtime dependencies. The temporary directory is removed afterward. The output
records each copied source's SHA-256 digest; `sourceBaseline` records the base
revision, while those digests identify the actual local source being tested.
`LICENSE` and `NOTICE` apply to the copied DPF source. The compiler is not
redistributed by this example.

## Contract and ownership

`decide`, MCDA quality gates and bounded retry preserve the existing pure math,
including signed cost dimensions, missing-feature/semantic fallback,
commandment conflicts, ties, sensitivity, three-band verdicts and legacy result
serialization. Their existing application tests now import the package.
Legacy `autonomyEligible`, confidence and `proceed` remain mathematical output;
they grant no permission.

`evaluateScopedAdvice` adds separately tested rejection rules. The host supplies:

- The exact platform owner for WWMD, organization owner for WWWD, or profession
  owner for WSID, plus the subject revision and WSID producing gate identity.
- Current owning-scope context and principle snapshots, each with source id,
  revision, digest and current/revoked status.
- One explicit hard-eligibility result for every option, named exclusion
  reasons and revisioned constraint references.
- Its existing pure feature-catalog validation function. DPF retains its
  dimension catalog and feature policy in the application; this package does
  not create a competing domain catalog.

The boundary checks source identity/revision/digest against the host's current
snapshot and holds missing, stale, revoked or wrong-owner context. It applies
hard eligibility before preference scoring and holds when no option qualifies.
The host authenticates all those facts, binds references to actual source bytes,
resolves applicability and current domain constraints, and fences any effects.
Caller-supplied reference strings are not signatures or proof of authority.
Cross-scope fallback cannot replace missing owning-scope context here.

Version 0.1 bounds options to 1–64, principles to 1–128, each dimension map to
64 keys, embeddings to 4096 components, ids/references to 256 characters and
names/descriptions to 4096. Feature magnitudes and weights are finite [0,1];
signed principle dimensions and embeddings are finite [-1,1]. Configuration
accepts recognized stakes, unit-interval thresholds, sensitivity epsilon (0,1]
and integer minimum feature count 1–64. Duplicate option identity uses the
existing canonical `validateOptionIdentities`; duplicate principles, missing
eligibility and unknown configuration keys hold. These are intentional new API
diagnostics, not changes to permissive legacy scoring. Callers needing other
bounds must agree a new contract version rather than silently widen 0.1.

## Scenarios and limits

The smoke checks all three scopes, negative cost dimensions, hard exclusions,
absent/cross-scope/stale/revoked context, duplicate identities, nonfinite values,
missing domain validation, raw no-signal abstention, and synthetic WWWD owner
capture followed by a revisioned same-scope consult. Capture needs a separately
admitted exact request/advice payload and matching synthetic owner. Changed
payload, wrong organization, wrong scope and intent without admission refuse.
It only advances a local context revision; it creates no decision ledger.
Portable WSID feedback is explicitly unsupported.

The fixture's owner identity and exact-payload admission are supplied test
facts. Production authentication, corpus quality, producing-gate enforcement,
durable receipts, outcome capture, revocation races and admission remain host
responsibilities. Current DPF MCP profile resolution is additive attribution;
this extraction does not fix its WWWD owner-profile targeting gap. Existing
organization/profession gates and capture tests characterize their adapters,
not a qualified portable ownership loop. Native gates remain unrun under the
explicitly authorized local refactor exception.

## Absorption and retirement

Consumers may copy the listed closure with its notices or import
`@dpf/validators/judgment`. Supply the owning domain port and retain one corpus,
owner decision store and admission path. DPF's MCP, perspective, ledger,
golden/backtest and retry callers use the package. The displaced three scoring
modules are removed; the wiki address remains one compatibility re-export for
the canonical decision skill's source citation, owned by @markdbodman under
BI-4DD124E7 until that citation and remaining source readers migrate. The golden guard
uses a generated JavaScript distribution of this scorer instead of maintaining
duplicate math. Its Node >=20 runtime needs no TypeScript installation or native
TypeScript loader. `scripts/build-judgment-guard-runtime.mjs` uses the pinned
TypeScript 6.0.3 build tool to produce the two modules and an exact source/output
SHA-256 manifest. The derived-artifact registry regenerates/stages that
distribution for source changes; its `--check` and fixture tests run in the
derived-artifact source guard, which already installs the isolated compiler
runtime. The PR decision-baseline guard stays dependency-free. Maintenance owner:
@markdbodman, BI-4DD124E7. Change the
canonical TypeScript and regenerate; never edit emitted math by hand. App
`option-input-contract.ts` retains feature validation and reuses the extracted
identity helper. Workroom, work-case and ledger scope names alias the single
`decision-scopes.ts` tuple without new values or schema changes.

Rollback the moved implementations and their import migrations together. This
slice does not replace authenticated owning decisions, grant intersection,
human admission, scoped retrieval, outcome persistence or production gates.
