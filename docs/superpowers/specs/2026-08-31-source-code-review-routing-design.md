---
status: proposed
---

# Source-code reviewer routing repair

- **Date:** 2026-08-31
- **Backlog item:** BI-F9E1A9CB
- **Workroom:** WC-42C43942
- **Scope:** platform inference screening and provider routing
- **Base:** `f16d4ad25639623b8cc18afadc0e12fc3d439ad4` (`origin/main`)

## Decision

An inference payload whose only governed class is `source-code` remains
`confidential`, but exact source is not subjected to the generic span-mask
obligation. The source-code vertical policy authorizes the untransformed form to
continue to the existing provider-suitability gate, which requires a reviewed
business or enterprise connection with proven no-training treatment. The screen
raises residency to `approved_cloud`, retains the source-code policy's log-use
obligation, and records `source-code-provider-controls-required` as the reason.

The exception is exact and closed: if any other governed class is present, its
normal policy still decides. Employee, finance, credentials, restricted, and
unknown data therefore remain fail-closed and cannot inherit the source-code
route.

## Observed defect and research evidence

On the named base above, a conversation containing this ordinary code body:

```ts
export function workroomDrive() { return "ready"; }
```

classifies as `source-code`, receives only a generic `mask` obligation, and
becomes `local-only`. This happens before provider suitability is evaluated.
`createRoutedInferenceScreen` then attempts masking; `maskForContext` cannot
cover a whole-body code match without destroying the code and throws
`ContextMaskCoverageError`; `routed-screening.ts` catches that error and returns
the original local-only screen without recording the failed transform.

The regression was first run against the unmodified base and failed at
`screen-inference-payload.test.ts` with `obligationKinds === ["mask"]` instead
of the expected provider-controlled route. Nine adjacent tests passed. After the
proposed change, the source-only case and the mixed-data counterexample pass,
along with 75 tests across the screening, policy-pack, routed-screening, and
provider-suitability suites.

### Candidate causes ruled out

1. **Provider posture is not the initiating cause.** The raw screen is already
   `local-only`; `inference-dispatch-guard` excludes cloud candidates before
   their account evidence can decide eligibility.
2. **Instruction provenance is not the initiating cause.** PR #4616 correctly
   excludes platform-authored job-description text. The reproduction places
   code in the user message, where it is genuine turn data.
3. **Sensitivity clearance is not the initiating cause.** Source code is
   intentionally `confidential`. Lowering it would hide the data class's real
   protection need and broaden egress beyond this defect.
4. **A whole-body masking transform is not viable for review.** Replacing or
   summarizing the function removes the exact semantics a code reviewer is
   required to inspect. Span masking remains appropriate for discrete values in
   mixed payloads, which this repair leaves unchanged.

## Existing substrate used

- `vertical-source-code` remains the canonical class policy. It already declares
  protected external use and the provider evidence expected for source code.
- `compileAiProviderSuitabilityPolicy` remains the connection gate. It already
  denies source code to unreviewed, personal, or training-enabled cloud accounts.
- `InferenceDataScreenReceipt` remains the audit record. No new table, enum,
  provider type, or parallel authorization store is introduced.
- `approved_cloud` remains the existing residency posture for confidential,
  externally eligible work.

## Security standard alignment

NIST SSDF SP 800-218 PS.1 requires source code to be available only to
authorized people, tools, and services, with protection appropriate to whether
the code is public or private. This repair follows that control shape: it does
not make source public or unrestricted; it routes exact code only to a provider
connection that the existing suitability policy has authorized, while retaining
versioned audit evidence. Source: https://csrc.nist.gov/pubs/sp/800/218/final

The NIST AI RMF Generative AI Profile emphasizes risk controls that are specific
to the deployment context rather than treating every generative-AI use as one
undifferentiated risk. DPF applies that pattern by keeping the exact data-class
and connection-evidence checks instead of using an unsatisfiable generic mask as
a proxy. Source: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf

## Objectives and acceptance

- **OBJ-SCR-001:** Governed source-code-only review can reach an eligible,
  approved-cloud provider instead of being silently clamped to local inference.
- **OBJ-SCR-002:** Source code retains confidential classification, provider
  evidence controls, and auditable policy explanation.
- **OBJ-SCR-003:** A payload combining source code with a stricter governed class
  retains the stricter class's local-only or denied outcome.

| Acceptance ID | Objective | Statement |
|---|---|---|
| AC-SCR-001 | OBJ-SCR-001 | A source-code-only message produces `routeEffect=allow`, `residencyPolicy=approved_cloud`, no `mask` obligation, and the provider-controls explanation. |
| AC-SCR-002 | OBJ-SCR-002 | The same receipt retains `classifiedDataClasses=[source-code]`, `sensitivity=confidential`, and `log-use`. |
| AC-SCR-003 | OBJ-SCR-003 | A message containing source code plus employee and finance data remains `local-only`. |
| AC-SCR-004 | OBJ-SCR-001 | A live governed reviewer reads an immutable repository artifact and records its required receipt after deployment. |

## Ordered implementation plan

1. Add the failing source-only reviewer regression and a mixed-data safety
   counterexample at the inference screen boundary.
2. Let the canonical source-code vertical policy match the raw source form so
   its more specific protected-external decision is present.
3. Resolve only the generic span-mask obligation for a source-code-only policy
   result; retain the source policy's log-use obligation and add a stable
   explanation code.
4. Project that explicit result to `approved_cloud`; do not alter local-only or
   deny handling for any other policy result.
5. Run the targeted screening, policy-pack, routed-screening, and provider
   suitability suites; then run the web production build gate.
6. Land via a DCO-signed PR and merge queue, advance the canonical install, and
   execute AC-SCR-004 before resuming proactive Workrooms Phase A.

## Documentation impact

No user-facing configuration or workflow changes. The visible result is that an
existing governed reviewer route works as described rather than reporting a
misleading local-only/provider outage. This design and the BI evidence are the
necessary documentation; the provider setup guide remains accurate because
approved connection evidence is still required.
