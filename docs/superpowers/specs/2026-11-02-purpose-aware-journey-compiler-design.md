---
status: proposed
---

# Purpose-Aware Installation Journey Compiler

| Field | Value |
| --- | --- |
| Date | 2026-11-02 |
| Epic | `EP-1FABA22D` — Purpose-Aware Installation and Ecosystem Productivity |
| Backlog item | `BI-91EF130B` — Deterministic journey compiler and productivity projection |
| Workroom | `WC-DA92E712` |
| Implementation home | `apps/web/lib/workspace-home/activation-orchestrator/` |
| Parent design | `2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md` (superseded umbrella; retained as rationale) |
| Prerequisite | `BI-A9F60372` — typed installation intent and compatibility (done) |

## 1. Decision

DPF shall compile one deterministic, purpose-aware installation journey from the
confirmed installation operating profile and canonical evidence. The compiler
extends the existing workspace-home activation orchestrator; it is not a new
setup engine, workflow service, database table, trust mechanism, or authority.

The result is a read-only projection that answers three questions:

1. What outcome should this installation reach next?
2. What canonical evidence proves each milestone, and what needs attention?
3. Has this installation produced the first real value appropriate to its role?

The compiler covers all five operating purposes crossed with production,
development, and test environment classes. It keeps purpose and environment as
orthogonal facts, rejects incompatible relationship declarations explicitly,
and never turns a profile into permission.

## 2. Objectives

**OBJ-PJC-1:** Compile the same ordered journey, fingerprint, and readiness result from semantically equal canonical inputs.

**OBJ-PJC-2:** Give every supported purpose/environment profile an explicit first-value mission and prevent `productive` until its receipt is satisfied.

**OBJ-PJC-3:** Resolve milestones through a single evidence-condition contract that is explainable, remediable, privacy-safe, and stale-aware.

**OBJ-PJC-4:** Preserve the public `ActivationPlan` contract and translate legacy setup progress without resetting or rewriting existing evidence.

**OBJ-PJC-5:** Keep organization, federation, TAK, GAID, JSI, A2A, Hive, and capability owners authoritative; the journey only reads their evidence.

## 3. Current repository truth

- `packages/db/src/installation-operating-intent.ts` owns the five purposes, the
  three environment classes, validated semantic intent, and a deterministic
  operating-profile fingerprint.
- `apps/web/lib/installation-journey/operating-intent.ts` is the guarded
  `PlatformConfig` repository for semantic intent and bootstrap absorption.
- `apps/web/lib/workspace-home/activation-orchestrator/` already owns the
  `ActivationPlan`, canonical-data registry, signal registry, and pure-ish
  declaration walker. Its public shape has shipped consumers and tests.
- `PlatformSetupProgress.steps` and `.context` already hold the resumable legacy
  projection. `setup-progress-projection.ts` preserves out-of-order evidence and
  completion semantics.
- There is no justified new Prisma model. Canonical domain records remain the
  evidence; plan state is a projection.

## 4. External research and adopted patterns

| Reference | Useful pattern | DPF decision |
| --- | --- | --- |
| [Backstage Software Templates](https://backstage.io/docs/features/software-templates/) | Parameterized multi-step golden paths, review before execution, retained task history | Adopt a compiled, reviewable sequence and stable descriptors; reject a technical template catalogue as the first business experience. |
| [Temporal workflow model](https://docs.temporal.io/) | Deterministic workflow decisions, side effects outside workflow code, replayable history | Keep compilation pure and move canonical reads/writes to adapters; reject introducing Temporal or a second durable workflow runtime. |
| [Kubernetes API conventions](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md) | Separate desired specification from observed status; typed conditions carry reason/message and observation freshness | Adopt typed evidence conditions, source observation fingerprints, and explicit stale/unknown handling; do not copy Kubernetes API machinery. |
| [Humanitec Score](https://developer.humanitec.com/platform-orchestrator/examples/score/) | Declarative requirements compiled against platform capabilities | Adopt the separation of declarations from fulfillment; reject an infrastructure-workload schema for an organizational onboarding journey. |

These references reinforce an existing DPF rule: compilation describes and
explains; capability owners perform side effects and retain authority.

## 5. Contract

### 5.1 Inputs

```ts
type InstallationJourneyCompilerInput = {
  profile: InstallationOperatingProfileSnapshot;
  activationPlan?: ActivationPlan;
  evidence: Readonly<Record<JourneyEvidenceKey, JourneyEvidenceObservation>>;
  legacySetup?: LegacySetupProgressSnapshot;
};
```

Inputs are already-resolved canonical snapshots. The compiler does not query
Prisma, call a route action, establish a federation link, grant authority, or
invent missing evidence. Adapters may read canonical owners before calling it.

### 5.2 Evidence conditions

```ts
type JourneyConditionStatus =
  | "satisfied"
  | "attention"
  | "blocked"
  | "deferred"
  | "not-applicable";

type JourneyEvidenceCondition = {
  key: JourneyEvidenceKey;
  status: JourneyConditionStatus;
  reason: string;
  explanation: string;
  remediation?: JourneyActionAdapter;
  source: { owner: string; safeRef?: string; observedFingerprint?: string };
  observedAt?: string;
  staleAfterSeconds?: number;
};
```

`safeRef` may identify a canonical record but may not contain a token, secret,
raw document, unrestricted business value, credential, or prompt transcript.
An observation whose declared freshness has expired resolves to `attention` or
`blocked` according to descriptor criticality; it never remains satisfied by
accident. Missing required evidence is `blocked`; a known unavailable future
capability is `deferred`; an inapplicable capability is `not-applicable`.

### 5.3 Milestones and output

```ts
type InstallationJourneyPlan = {
  schemaVersion: 1;
  planVersion: string;
  profileFingerprint: string;
  journeyFingerprint: string;
  milestones: JourneyMilestone[];
  blockers: JourneyBlocker[];
  firstValueMission: FirstValueMission;
  readiness: "not-ready" | "productive" | "ecosystem-productive";
  legacyCompatibility: LegacySetupCompatibilityProjection;
};
```

Every milestone descriptor has a stable key, owning capability, applicability
predicate, evidence keys, route/action adapter, prerequisites, human-decision
flag, criticality, and staleness policy. Registry order is canonical. All sets
and caller-provided arrays are normalized before hashing. Wall-clock time,
mutable display copy, raw values, and secret material are excluded from the
journey fingerprint.

## 6. Profile matrix and first value

Each primary purpose has one first-value mission. Environment changes caution,
applicability, and topology; it does not silently replace the purpose.

| Primary purpose | First-value mission | Required receipt category |
| --- | --- | --- |
| `operate-organization` | Complete a governed real operational outcome | Accepted domain outcome plus governance receipt |
| `evolve-dpf` | Produce a verified change proposal without mutating production directly | Governed workroom/verification receipt |
| `deliver-managed-services` | Deliver one bounded customer outcome inside the customer's authority boundary | Customer-scoped service outcome and receipt |
| `grow-channel` | Enable one governed partner/channel outcome | Partner agreement/entitlement outcome and receipt |
| `participate-community` | Contribute or absorb one reviewed, provenance-preserving learning | Hive contribution/absorption receipt |

The compiler contains descriptors only in this slice. Domain-specific receipt
resolvers remain capability-owner work. Until a real receipt is supplied, the
plan cannot return `productive`, even when every setup route was visited.

All 15 purpose/environment combinations compile deterministically. Relationship
intent compatibility is evaluated independently: for example, a development
companion may recommend `same-organization`, while an unsupported or conflicting
relationship becomes a blocker or explicit non-applicability, never an implicit
trust relationship.

## 7. Compatibility and persistence

`ActivationPlan` remains source-compatible. New types are additive and exported
from the same barrel. `journey-compiler.ts` may embed or reference an
`ActivationPlan`; it does not duplicate its canonical-data counts or signal
bindings.

Legacy `SETUP_STEPS` values map to stable milestone keys through a versioned
adapter. Completed or skipped legacy evidence may pre-satisfy the corresponding
milestone in the projection, but the compiler performs no writes. A later
projection service may store `planVersion`, `journeyFingerprint`, and condition
summaries in existing `PlatformSetupProgress` JSON. Rollback disables the new
consumer and continues using the legacy projection without deleting intent or
domain evidence.

## 8. Authority and safety boundaries

- Operating purpose expresses intent; it grants no identity, credential,
  capability, trust, approval, funding authority, or peer write access.
- Federation readiness is read from `FederationLink` and its capability-owner
  evidence. The compiler cannot create, approve, trust, quarantine, or revoke a
  link.
- A2A, GAID/AIDoc, TAK, JSI, and Hive states are evidence summaries only. Missing
  implementation stays `deferred` or `blocked`, never synthetic success.
- Remediation names a stable route/action owner. The compiler never invokes it.
- Unknown environment or corrupt intent fails toward production caution and an
  attention/blocker condition.

## 9. Bounds and scale ceiling

The first release supports one primary purpose, up to four secondary purposes,
the three canonical environment classes, the four existing federation
relationship presets, at most 64 milestone descriptors, and at most 256
evidence observations per compile. Compilation must remain synchronous,
side-effect-free, and linear in descriptors plus observations. Profiles beyond
these limits fail validation instead of silently truncating. A future need for
unbounded dynamic journeys or third-party descriptor execution requires a new
epic and architecture decision; it is not smuggled into this compiler.

## 10. Acceptance and traceability

| Acceptance ID | Objective IDs | Acceptance statement | Verification |
| --- | --- | --- | --- |
| AC-PJC-1 | OBJ-PJC-1 | Five purposes crossed with three environment classes compile deterministically. | Table-driven 15-case matrix plus ordering/fingerprint tests. |
| AC-PJC-2 | OBJ-PJC-3 | Milestones resolve canonical evidence as satisfied, attention, blocked, deferred, or not-applicable. | Evidence-condition unit tests covering present, missing, stale, denied, corrupt, deferred, and inapplicable sources. |
| AC-PJC-3 | OBJ-PJC-4 | Existing activation plans and legacy setup progress remain compatible. | Existing walker tests plus compatibility fixtures for completed, skipped, pending, and out-of-order legacy progress. |
| AC-PJC-4 | OBJ-PJC-2 | Productive cannot be returned without the profile first-value receipt. | Negative tests across all five purposes and positive receipt fixtures. |
| AC-PJC-5 | OBJ-PJC-5 | No sibling orchestration substrate is introduced. | Diff and dependency scan show implementation only in the existing package and no Prisma migration/model. |

## 11. Rollout and rollback

Land the compiler as an additive read-only library with no default UI consumer.
Compare projections in tests before routing the Workspace companion to it. A
rollback removes or disables the consumer and leaves the legacy setup path,
intent record, federation state, canonical domain evidence, and existing
`ActivationPlan` untouched.

