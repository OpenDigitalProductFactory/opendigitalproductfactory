// apps/web/lib/build/owner-decision-pending.ts
//
// BI-C35F1FED — is the platform waiting on the owner?
//
// The quiet detector measures whether the PLATFORM has gone quiet. When the
// next action belongs to the owner, quiet is the expected state and not a
// fault: the platform has deliberately stopped and handed over a control.
//
// Live repro FB-05946F96 on the Pet Rescue install. "Start a new outcome"
// created a build awaiting approval. Ten minutes later the early-phase quiet
// threshold fired, the custodian card REPLACED the approve-start CTA, and the
// owner was told "Build Studio may be stuck — review the current step and
// resume it if needed" with no control that could do either. The one button
// that would have started the work disappeared because they had not pressed it
// quickly enough.
//
// Scoped deliberately to approval. Other owner-facing actions can coexist with
// genuine platform stalls; approval cannot, because until it is given the
// platform has not started and has nothing to be quiet about.

/** True when the build's next action is the owner's to take, not the platform's. */
export function isAwaitingOwnerDecision(actionKind: string): boolean {
  return actionKind === "approve-start";
}
