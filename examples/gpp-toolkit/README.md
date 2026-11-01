# GPP toolkit consumer

This is a synthetic consumer of the extracted GPP compiler, browser tooling and
Workroom marking kernel. It contains no DPF application imports, private corpus,
real customer facts or authenticated principals. Compilation is never admission,
qualified enforcement or permission to execute a tool.

Run `node examples/gpp-toolkit/run.mjs` using Node **24.16.0**. The runner defaults
to its own Node executable; `GPP_TOOLKIT_NODE24` can select an executable with that
exact version. It verifies the external repository build tool is TypeScript
**6.0.3**. It creates a temporary ESM consumer outside the checkout, copies only
the sources listed in `closure.json` and the fixture, builds with NodeNext, runs
the emitted JavaScript, and removes the temporary directory afterward. There are
no application aliases or links to producer dependencies in that consumer.

The Workroom source paths now contain compatibility exports of the independently
maintained artifact named by `closure.json`. Bundled npm installs that exact local
archive offline, with strict engine checks and scripts disabled, in a separate
temporary package. Its regular emitted files and declarations join the consumer;
only its declared exports are admitted. The helper verifies SHA-256, version and
complete dependency-free emitted closure. No registry download or application
boot is required. Workroom remains first-party; Zod remains the only third-party
runtime dependency.

## Declared closures

- `gpp/browser.ts` exports schemas, parser, resolver, checks, lowering, decompile,
  draft binding output and reference interpretation. Its independent compile
  uses `types: []`, `lib: ["ES2022", "DOM"]`, strict checking and no skipped
  declaration checks. Zod's declarations require the browser's `URL` type; an
  ES2022-only run observed that missing platform type. The runner traverses the
  actual TypeScript import/export syntax and refuses Node builtins in this entry.
  Its contract smoke runs under Node; this is not real browser or CSP acceptance.
- `gpp/compiler.ts` additionally uses Node's `node:crypto` for the existing SHA-256
  digest. It compiles separately with Node declaration types. The actual generated
  TypeScript module is compiled against the portable WorkShape contract, then
  its emitted JavaScript is imported. The fixture supplies the explicit
  `../kernel/gpp/work-shape-contracts.js` type destination.

Zod **4.6.7** is the only third-party runtime dependency. The runner copies its
installed regular package distribution, including its MIT license, into the
temporary consumer and emitted output. It verifies the version, refuses package
symlinks and reports a deterministic hash of the complete copied distribution.
It does not download or install dependencies.

`@dpf/integration-shared/canonical-json` retains its bare import. Exactly its
existing pure TypeScript source is copied into a minimal temporary ESM package;
the emitted JavaScript and declaration have their own explicit export addresses.
The algorithm is unchanged. Its parent package declares `undici`, but that
runtime is neither copied nor evaluated by this deep-entry closure.

`@types/node` **26.6.5** and its pinned `undici-types` declaration dependency are
copied for the Node compilation only. They are build-time declarations, not
runtime dependencies; the `undici` runtime is not used. The compiler stays an
external build tool. The runner reports source SHA-256 values and dependency
distribution identities. `sourceBaseline` identifies the base revision; those
hashes identify the actual local source tested. The temporary manifest and lock
record exact versions; this fixture materializes verified installed distributions
rather than claiming a registry download/integrity or reproducible npm install.

## What the fixture checks

The browser entry checks strict source/schema behavior, decoded duplicate keys,
syntax, BOM/CRLF/trailing content, depth limits, unknown fields, JSON Schema and
layout identity, malformed graph references and failure/budget exits. Injected
synthetic tool registration, grants and policy facts remain separate from C-5
capability co-occurrence, which stays `not-evaluated`. C-7 reports sandbox
containment as informationally not applicable when no sandbox stages are declared;
this is never a containment pass. A declared sandbox stage without an environment
binding fails the model check. Neither result verifies an actual sandbox. C-8
transition mediation stays `not-evaluated` without a host declaration; a supplied
declaration is reported as a declaration and never as verified mediation.

The Node entry checks key-order and whitespace-independent digest/module bytes
and diagnostics, decompile/legacy compatibility, and no executable output when
policy, tool registration, grant mappings, classification or direct/transitive
sub-shape facts are unavailable. A compiled serial routine shape feeds the
extracted marking step; missing, blocked and wrong-run observations do not move
it, while an exact supplied observation reaches its declared success stop.

The optional `CompileDiagnosticDisposition` port is a trusted host's offline
assessment/emission policy. Ordinary compilation blocks every error even if a
diagnostic carries a `knownFinding` annotation. Required policy, registered tool,
grant mapping, classification and complete bounded child facts hold before the
port can run. A throwing port holds without exposing its private exception.
The DPF adapter alone selects its source-controlled exact known-finding matcher,
restricted with sandbox facts to `declared-flows` paths. Stale or expanded findings
refuse generator output; a rejected compile preserves earlier generated bytes.
Sidecars, registry policy and DPF's loader are absent from this copied closure.
This port never supplies execution admission or waives the actual human decision.

A second serial model produces a binding **draft** with exact shape, stage,
binding version, owning scope and tool identities. The draft does not contain
an assigned actor or accepted output artifact. A small sample mapping therefore
requires separate synthetic actor, actions, output kind/content/revision, profile,
binding, data/effect/cost boundary and qualification references. It preserves
the binding's entry gate stage, authority, scope and mode separately from the
current stage's completion checkpoint and assigned
executor, distinguishes absent tools from an explicit empty declaration, and refuses missing or unsupported
graph/sub-shape/deadline mappings. The host supplies the output kind; evidence
vocabulary alone does not establish an accepted artifact.

For the generated human stage, the sample host withholds a completing receipt
until a separately supplied synthetic owner decision matches the exact mapped
payload, run and observation. The supported checkpoint must name an exact person;
unresolved roles refuse. A changed checkpoint cannot reuse the prior human.
Wrong actor or changed content stays held. These are test facts; there is no authentication, provider, shell, durable transaction,
decision service or tool executor here. The Workroom kernel consumes the host's
observations and does not authenticate them.

GPP 0.19 whole actor/session capability aggregation, including combinations spread
across stages, remains **unsupported and unqualified**. Neither `accepted: true`,
a binding label, a ratification fixture, a mapping result nor a validator stands
in for that assessment or its attributable human decision. DPF's enforcement
state and actual admission remain in its adapters; this example promotes neither.

A negative fixture assigns untrusted-input, sensitive-read and state-change
capabilities to three serial stages for the same explicit actor and session.
An initial synthetic checkpoint supplies each model's binding entry owner. Each
capability stage with its entry checkpoint and the combined structural model compile using supplied tool and
grant facts, while C-5 remains `not-evaluated`. A fixture-local host guard has no
admit branch for this unsupported, unqualified combination: favorable stage
checks, a validator result and a `doctrine-then-human` label all leave it held.
[GPP §8](../../docs/architecture/gated-permissions-process.md#8-capability-co-occurrence)
still requires an actual attributable human decision admitting the distinct class
and covering the accountable principal, binding versions, subject scope and
validity. This demonstrates refusal of this known fixture, not a general
aggregation engine or portable C-5 enforcement.

DPF2's `docs/reviews/PRODUCER-EXTRACTION-CONSUMER-REVIEW.md` specifies candidate
sequential-interchange profile 0.1 and paired SI-01–08 cases. They are specified
and unrun; this fixture does not implement that importer or qualify its mappings.
Any selected translation must retain separate accountable/executor identities,
explicit unsupported-field refusals and DPF2's existing `artifact-custody.ts`,
`work-package.ts`, current admission and Store owners. Retire only structural or
translation code actually replaced after paired compatibility checks.

## Maintenance and rollback

DPF's GPP implementation remains in `packages/validators/src/gpp`; its Workroom
paths bridge to the pinned independent artifact. The current DPF canonical JSON
leaf is unchanged. This pilot does not adopt the independent GPP package. Update the explicit
manifest when those imports change, then rerun both closure builds, the behavioral
smoke and generated-output compilation. The real DPF generator remains
`apps/web/scripts/build-gpp-shapes.ts`; its byte-parity check is separate evidence.

The example and copied internal source carry the repository's Apache-2.0
`LICENSE` and `NOTICE`. Copied third-party distributions retain their own notices.
No package is published by this runner. Roll back the extracted source and its
application import migration together; remove this example with that rollback.
This fixture does not supply native runtime acceptance, production acceptance or
actual browser qualification.
