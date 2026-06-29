# Regulatory Autonomy Ceiling Policy Design

## Purpose

`BI-40CD8ACD` adds the policy layer that caps progressive autonomy independently of measured trust. A coworker may earn trust through agreement evidence, but regulated work still needs a separate ceiling that comes from industry, jurisdiction, activity class, and human-control requirements.

This slice makes the ceiling data-driven and auditable without introducing a full policy engine. It adds a versioned policy table, a pure resolver, and ledger evidence fields so later TAK, Work Case, WWMD, and operator UI slices can use the same substrate.

## Research and Benchmarking

- Open Policy Agent uses policy-as-code with decision logs for auditability, including queried policy, input, bundle metadata, and other debugging context. DPF adopts the audit lesson, not the runtime dependency: ceiling decisions must be explainable and recordable. Source: https://openpolicyagent.org/docs and https://openpolicyagent.org/docs/management-decision-logs
- Amazon Verified Permissions separates authorization policy from application logic through Cedar and supports RBAC plus ABAC conditions. DPF adopts the separation: trust graduation logic does not hard-code regulation facts; the resolver receives policy rows as data. Source: https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/what-is-avp.html and https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/terminology.html
- OpenFGA models authorization from stored relationship tuples plus contextual tuples for request-time facts. DPF adopts the same split between durable policy rows and request/install context, but avoids a ReBAC engine because this is an autonomy ceiling, not relationship authorization. Source: https://openfga.dev/docs/concepts and https://openfga.dev/docs/interacting/contextual-tuples
- ServiceNow GRC positions policy lifecycle, continuous monitoring, and compliance/risk visibility as one program. DPF adopts the lifecycle stance: policy rows are versioned, statused, effective-dated, and suitable for future compliance UI review. Source: https://downloads.docs.servicenow.com/pdf/enus/servicenow-xanadu-governance-risk-compliance-enus.pdf

## Design

### Data Model

Add `RegulatoryAutonomyPolicy` near the existing compliance/runtime governance tables.

Each row represents one versioned rule for an activity class in an industry and jurisdiction context:

- `policyId`: unique row id.
- `policyKey`: stable lineage key shared by versions.
- `version`: integer version under the policy key.
- `industry`: optional business-context industry or archetype category. Null means cross-industry.
- `jurisdiction`: jurisdiction slug such as `eu`, `us`, or `global`.
- `jurisdictionBasis`: one of the existing profession jurisdiction bases, such as `operating`, `selling`, `employing`, `data-residency`, or `global`.
- `activityClass`: exact activity class or `*` for a fallback policy.
- `maxAutonomyLevel`: `shadow`, `propose`, `supervised`, or `autopilot`.
- `humanControlRequired`: whether the policy mandates human control even if the ceiling is above `propose`.
- `requiredEvidence`: JSON array of evidence keys that must be captured.
- `regulationId`: optional semantic link to a `Regulation`.
- lifecycle fields: `status`, `sourceKind`, `effectiveFrom`, `effectiveUntil`, `rationale`, timestamps.

Add optional regulatory evidence columns to `DecisionShadowLedger`:

- `regulatoryPolicyId`
- `regulatoryEvidence`

The ledger keeps evidence; it does not decide. The resolver decides what evidence is required.

### Resolver

Add `apps/web/lib/autonomy/regulatory-ceiling.ts` with a pure function:

`resolveRegulatoryAutonomyCeiling({ policies, profile, industry, activityClass, asOf })`

Rules:

1. Filter to active policies whose effective window contains `asOf`.
2. Match activity by exact class or `*`.
3. Match industry by exact industry, null, or `*`.
4. Use the existing `regulationApplies` basis/jurisdiction logic for regional scope.
5. If multiple policies apply, the effective ceiling is the most restrictive `maxAutonomyLevel`.
6. If no policy applies, default to `propose`, require human control, and return a reason that operator policy review is required.
7. If a matching policy row contains an invalid autonomy-level string, treat that row as `propose`, require human control, and require operator policy review evidence.

The resolver returns the ceiling, matched policies, required evidence keys, human-control requirement, and a human-readable reason.

### Integration

The trust core already accepts `regulatoryCeiling`. This slice keeps that boundary and improves one caller:

- `resolveWorkCaseAutonomyEnvelope` should distinguish regulatory caps from risk caps in its reason when `regulatoryCeiling` is more restrictive.

Runtime policy fetching, operator policy UI, and automatic Decision Shadow Ledger writes are intentionally not wired here. Later slices can read `RegulatoryAutonomyPolicy`, call the resolver, pass its `ceiling` into trust-state/work-case evaluation, and store the policy/evidence result in `DecisionShadowLedger`.

## Non-Goals

- No external policy engine adoption.
- No UI for managing policies.
- No legal advice, regulatory content generation, or seeded regulation facts.
- No automatic autonomy promotion or demotion.
- No runtime Work Case/TAK/WWMD policy fetch yet.

## Verification

- TDD tests for the resolver:
  - unknown policy defaults to `propose` and human control.
  - matching policy caps a low-risk activity despite high trust.
  - multiple matching policies choose the most restrictive ceiling and union evidence keys.
  - out-of-scope jurisdiction does not match.
  - malformed autonomy-level strings default safely to `propose` and operator review.
- Existing trust and Work Case autonomy tests stay green.
- Prisma schema validates, client generates, db/web typecheck pass.
- Migration applies cleanly to a throwaway database under the local-integration lease.
