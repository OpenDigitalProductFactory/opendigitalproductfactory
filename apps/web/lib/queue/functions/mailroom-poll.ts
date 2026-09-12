// Mailroom mailbox poll (design 2026-09-09 §4.4, BI-9C362E23).
//
// Every fifteen minutes, read every connected mailbox whose next-poll time has
// passed (each mailbox carries its own interval, default sixty minutes — the
// "near-hourly" the archetype asks for) and run the loop for what arrived. A
// platform job, so the guarantee holds with no AI client and no coworker
// present. Honours the scheduled-jobs kill switch. Minute offset staggered off
// the :00/:15 batches.
//
// The requested-event variant polls ONE mailbox now: the connect flow's first
// read and the Mailroom page's "Check now".

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const MAILROOM_POLL_INNGEST_ID = "mailroom/mailbox-poll";
export const MAILROOM_POLL_CRON = "9,24,39,54 * * * *";
export const MAILROOM_POLL_REQUESTED_EVENT = "mailroom/mailbox-poll.requested";

export const mailroomMailboxPoll = inngest.createFunction(
  { id: MAILROOM_POLL_INNGEST_ID, retries: 1, triggers: [cron(MAILROOM_POLL_CRON)] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, MAILROOM_POLL_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("poll-due-mailboxes", async () => {
      const { pollDueMailboxesForInstall } = await import("@/lib/mailroom/runtime.server");
      const outcomes = await pollDueMailboxesForInstall();
      return {
        status: "polled",
        mailboxes: outcomes.length,
        ingested: outcomes.reduce((n, o) => n + (o.ok ? o.data.ingested : 0), 0),
        errors: outcomes.filter((o) => !o.ok).map((o) => o.mailboxRef),
      };
    });
  },
);

export const mailroomMailboxPollRequested = inngest.createFunction(
  { id: "mailroom/mailbox-poll-requested", retries: 1, triggers: [{ event: MAILROOM_POLL_REQUESTED_EVENT }] },
  async ({ event, step }) => {
    const mailboxRef = typeof event.data?.mailboxRef === "string" ? event.data.mailboxRef : null;
    if (!mailboxRef) return { status: "refused", reason: "mailboxRef required" };
    return step.run("poll-one-mailbox", async () => {
      const { pollMailboxNow } = await import("@/lib/mailroom/runtime.server");
      const outcome = await pollMailboxNow(mailboxRef);
      return { status: outcome ? (outcome.ok ? "polled" : "failed") : "skipped", outcome };
    });
  },
);
