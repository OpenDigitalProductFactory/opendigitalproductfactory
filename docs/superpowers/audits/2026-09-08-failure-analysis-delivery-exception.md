# Failure-analysis gate delivery exception

The operator authorized publication despite unavailable process gates: “if you need to PR without all the gates, do that because we need to PR to fix the gates”. This authorization applies to delivering the shared failure-analysis requirement, not general future changes.

On this run, source preparation resumed in the existing governed branch. The live plan-coverage write initially required synchronizing the new commit; that synchronization succeeded. Its corrected write and implementation admission then returned `portal_quiescing`, level `draining`, with `writesRefused: true`. No runtime write is bypassed. Coverage and independent review remain uncompleted until their actual receipts exist. Source implementation may proceed under the operator's scoped exception while the service recovers. Any unavailable check is reported as unrun or inconclusive, never passed.

The plan-only commit was made with commit hooks disabled; the subsequent normal push passed the DCO and docs-only push gates. Further commits use the normal hooks. This record does not retrospectively claim that disabled hook execution passed.

DCO, GitHub branch protection, grant intersection, independent risk acceptance, destructive-action controls and production integrity remain mandatory. The exception authorizes neither self-approval nor fabricated evidence. The final PR must enumerate actual tests, review outcomes, enforcement boundaries and limitations.

Recovery update: the live service subsequently recorded passing research, specification, architecture and plan reviews, accepted atomic plan coverage, and allowed implementation admission. These gates are no longer outstanding. The scoped publication exception remains applicable to the source-only contribution and bootstrap of the new status producer: the current install cannot issue the new failure-readiness status until this code is released. Local integration and live workflow verification are not claimed as passed; existing cloud checks and DCO remain required. Deploy and verify the producer before applying the new required repository context.
