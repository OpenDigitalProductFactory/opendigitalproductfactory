# Coworker Interaction Contract - Surface Gap Follow-up

## Status

PR #1406 shipped the shared coworker interaction contract, and later work extended it with clarify-vs-proceed and button-decision guidance. This follow-up closes two remaining implementation gaps: deterministic coworker fallback strings and the Build Studio customer status band.

## Evidence

- `apps/web/lib/tak/coworker-interaction-contract.ts` is the shared prompt/formatter choke point for operational closeouts.
- `apps/web/lib/actions/agent-coworker.ts` still contained hardcoded ideate/provider failure messages that ended without a consistent status, evidence, next action, and owner.
- `apps/web/lib/build/customer-status-projection.ts` and `apps/web/components/build/BuildCustomerStatusBand.tsx` projected status and worker labels but did not expose evidence, next action, or owner.

## Change

- Add a shared deterministic formatter for summary-plus-closeout coworker messages.
- Route ideate fallback and provider failure messages through the formatter.
- Extend the Build Studio customer status projection with evidence, next action, and owner.
- Render those operational fields in the status band and cover them with targeted tests.

## Verification Plan

- Targeted unit/render tests for the closeout formatter, status projection, and status band.
- Web typecheck.
- Production web build.
- Contributor-preview UX observation of the Build Studio status band showing Evidence, Next action, and Owner.

## Next Action

Owner: reviewer. Review the follow-up PR, then let CI validate the pushed branch before merge queue admission.
