// Ratified page-purpose contracts for /workspace/mailroom and its item view
// (design 2026-09-09 §4.9/§6, BI-727D5FD9). The purpose-identity ratchet
// refuses to grandfather a NEW route, so the Mailroom arrives ratified.

import type { PurposeContractModule } from ".";

export const MAILROOM_PURPOSE_CONTRACTS: PurposeContractModule = [
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/workspace/mailroom",
    intent: {
      primaryUser:
        "The owner, or the person who answers the business's correspondence, checking what arrived and what nobody has picked up.",
      triggeringNeed:
        "Knowing which mailboxes the platform is reading, what came in, why each sender wrote, and which messages are waiting past their window — without opening a mail client.",
      prerequisites: [
        "Signed in as an operator.",
        "Setup has chosen a business type, so the expected mailboxes are known.",
      ],
      job: "See the mailboxes being read and when, the items nobody has acknowledged worst first, and today's arrivals by reason; connect, pause, test or remove a mailbox.",
      successOutcome:
        "The reader can say which mailboxes are connected and healthy, name the oldest unacknowledged message and its reason, and open it in one click.",
      findability: {
        parentArea: "Workspace",
        entryPoints: ["/workspace", "Workspace > Mailroom", "the Mailroom setup step"],
        navigationLayer: "Workspace section nav, beside Needs you and Documents",
        discoveryCue: "A 'Mailroom' item in the Workspace section.",
        expectedPath: ["/workspace", "/workspace/mailroom"],
      },
      contentRoles: {
        defaultVisibleKeys: ["mailbox-list", "unacknowledged-items", "connect-mailbox"],
        deferredRegions: [
          {
            key: "all-items",
            role: "Every item, filterable by reason, urgency and queue.",
            trigger: "Reader chooses a filter or opens All items.",
          },
          {
            key: "connect-form",
            role: "Provider, address, purpose, credentials and interval for a new mailbox; probes before it saves.",
            trigger: "Reader opens Connect a mailbox.",
          },
        ],
      },
      familyConsistency: {
        terminology:
          "Speak the business's words: mailbox, message, sender, reason, acknowledged, replied. Never channel, payload, classification or status code.",
        actionLocation:
          "Acknowledge and open sit on each item row; mailbox controls sit on each mailbox card; connect is one disclosure below the mailboxes.",
        feedbackPrimitive:
          "Shared form primitives announce a probe result before a mailbox is saved; a failed probe shows the safe provider error inline and saves nothing.",
        disclosurePattern:
          "Mailboxes and the unacknowledged list are open on arrival; the full item list and the connect form are behind native disclosures.",
        returnBehavior: "The reader returns to the Workspace through the same section navigation.",
      },
    },
    stateScenarios: {
      "no-mailbox": {
        statePredicate: "The organisation has no MailboxAccount.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/workspace/mailroom/page.tsx",
        },
        essentialEvidenceKeys: ["education-notice", "expected-mailboxes", "connect-mailbox"],
        primaryExperience: { kind: "informational", messageKey: "mailroom.no-mailbox" },
        prohibitedActionKeys: ["show-empty-table"],
        completionSignal:
          "The page says in three sentences what the Mailroom does, lists the mailboxes a business of this kind usually runs, and offers to connect one.",
        errorCorrection:
          "Connecting a mailbox probes the provider first; a failed probe explains itself and leaves nothing behind.",
        recovery: { actionKey: "connect-mailbox", routePath: "/workspace/mailroom" },
      },
      "mailboxes-connected": {
        statePredicate: "At least one MailboxAccount exists.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/app/(shell)/workspace/mailroom/page.tsx",
        },
        essentialEvidenceKeys: ["mailbox-list", "last-polled", "unacknowledged-items"],
        primaryExperience: { kind: "informational", messageKey: "mailroom.connected" },
        prohibitedActionKeys: [],
        completionSignal:
          "Each mailbox shows its purpose, provider, status and last read; the unacknowledged list reads worst first.",
        errorCorrection:
          "A mailbox in error shows the safe provider message and a Test action; pausing keeps history and stops reading.",
        recovery: { actionKey: "open-workspace", routePath: "/workspace" },
      },
      "items-overdue": {
        statePredicate: "At least one routed item is past its acknowledge-by time or is immediate.",
        stateSource: {
          oracleKey: "route-owned-read-model",
          sourceRef: "apps/web/lib/attention/sources/mailroom-item.ts",
        },
        essentialEvidenceKeys: ["unacknowledged-items", "age-past-window"],
        primaryExperience: { kind: "informational", messageKey: "mailroom.overdue" },
        prohibitedActionKeys: [],
        completionSignal:
          "Overdue items lead the list with the time past their window, and the same items appear on Needs you.",
        errorCorrection:
          "Acknowledging records who and when and clears the item from both lists; it never deletes the message.",
        recovery: { actionKey: "open-needs-you", routePath: "/workspace/inbox" },
      },
    },
    taskProtocol: {
      startRoute: "/workspace/mailroom",
      taskPrompt: "Which message has waited longest past its window, who sent it, and why did they write?",
      completionOracle:
        "The first row of the unacknowledged list names that sender and reason, and opening it shows the message.",
      falseSuccessConditions: [
        "A noise message (auto-reply, bulk mail) is read as waiting.",
        "An acknowledged item is read as still waiting.",
        "A paused mailbox is read as being read.",
      ],
      acceptanceThresholds: [
        "The worst item is the first row on arrival, with no click.",
        "Every connected mailbox shows a last-read time or an error.",
        "A failed connect saves nothing and shows the provider's safe error.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "founder-direction:2026-09-09-mailroom" },
    reviewRef: "BI-727D5FD9",
    intentEvidenceRefs: [
      {
        kind: "operator-request",
        ref: "BI-4F7BB48B",
        summary:
          "The founder's Mailroom concept: receive, triage, route, notify, chase; and the 2026-09-09 direction that a rescue must read vet and adopter correspondence near-hourly and declare its mailboxes at setup.",
      },
      {
        kind: "existing-behavior",
        ref: "docs/architecture/archetypes/pet-rescue-operating-model.md",
        summary:
          "§7c names seven reasons a stranger arrives with their urgencies and states that no reply is possible from inside the product today.",
      },
    ],
  },
  {
    schemaVersion: 1,
    status: "intent-ratified",
    routePath: "/workspace/mailroom/items/[inboundId]",
    intent: {
      primaryUser: "The person who owns the queue a message was routed to, deciding what to do with it.",
      triggeringNeed:
        "Reading one message as received, seeing how the platform understood it, acknowledging it, and answering it without leaving the product.",
      prerequisites: ["Signed in as an operator.", "The item exists in the Mailroom."],
      job: "Read the message, its reason and urgency, the room it went to and who was told; acknowledge it; ask for a drafted reply and approve it.",
      successOutcome:
        "The message is acknowledged with a name and a time, and a reply is either sent threaded onto the sender's conversation or the reader knows exactly what blocks sending.",
      findability: {
        parentArea: "Workspace",
        entryPoints: ["/workspace/mailroom", "/workspace/inbox (Needs you card)", "the queue room's activity"],
        navigationLayer: "Detail page beneath the Mailroom",
        discoveryCue: "Open on a Mailroom row or a Needs you card.",
        expectedPath: ["/workspace", "/workspace/mailroom", "/workspace/mailroom/items/[inboundId]"],
      },
      contentRoles: {
        defaultVisibleKeys: ["message", "triage", "acknowledge", "reply"],
        deferredRegions: [
          {
            key: "raw-headers",
            role: "The threading and provider headers the platform kept.",
            trigger: "Reader opens Details.",
          },
        ],
      },
      familyConsistency: {
        terminology: "Sender, reason, urgency, acknowledged, reply, approve and send.",
        actionLocation: "Acknowledge and the reply controls sit beneath the message; nothing sends without Approve and send.",
        feedbackPrimitive:
          "A send that cannot happen says why and where to fix it; a sent reply shows when and to whom.",
        disclosurePattern: "Message and triage open; headers behind one disclosure.",
        returnBehavior: "Back to the Mailroom list.",
      },
    },
    stateScenarios: {
      "awaiting-acknowledgement": {
        statePredicate: "The item is routed and unacknowledged.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: "apps/web/app/(shell)/workspace/mailroom/items/[inboundId]/page.tsx" },
        essentialEvidenceKeys: ["message", "triage", "acknowledge"],
        primaryExperience: { kind: "informational", messageKey: "mailroom.item.awaiting" },
        prohibitedActionKeys: ["auto-send"],
        completionSignal: "Acknowledge records the reader and the time and the item leaves Needs you.",
        errorCorrection: "A wrong reason can be overridden on the item; the message itself is never edited.",
        recovery: { actionKey: "open-mailroom", routePath: "/workspace/mailroom" },
      },
      "reply-drafted": {
        statePredicate: "A pending-review draft exists for the item.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: "apps/web/lib/mailroom/reply.ts" },
        essentialEvidenceKeys: ["reply", "approve-and-send"],
        primaryExperience: { kind: "informational", messageKey: "mailroom.item.drafted" },
        prohibitedActionKeys: ["auto-send"],
        completionSignal: "The draft is editable and Approve and send is the only way it leaves.",
        errorCorrection: "With no outbound email configured, Approve and send reports the gap and links to Settings; nothing is recorded as sent.",
        recovery: { actionKey: "open-email-settings", routePath: "/admin/settings" },
      },
      "replied": {
        statePredicate: "The item has repliedAt set.",
        stateSource: { oracleKey: "route-owned-read-model", sourceRef: "apps/web/lib/mailroom/reply.ts" },
        essentialEvidenceKeys: ["message", "reply-sent"],
        primaryExperience: { kind: "informational", messageKey: "mailroom.item.replied" },
        prohibitedActionKeys: ["send-again"],
        completionSignal: "The page shows when the reply went and to whom.",
        errorCorrection: "A further reply starts from the room's conversation, not by re-sending.",
        recovery: { actionKey: "open-mailroom", routePath: "/workspace/mailroom" },
      },
    },
    taskProtocol: {
      startRoute: "/workspace/mailroom/items/[inboundId]",
      taskPrompt: "Acknowledge this message and send the sender a reply.",
      completionOracle: "The item shows acknowledged by the reader and replied at a time, and the draft's status is approved.",
      falseSuccessConditions: [
        "Drafting is read as sending.",
        "A send reported blocked by configuration is read as sent.",
      ],
      acceptanceThresholds: [
        "Acknowledge takes one click.",
        "A reply cannot leave without Approve and send.",
        "The blocked-by-configuration path names Settings.",
      ],
    },
    ratifiedBy: { role: "owner", ref: "founder-direction:2026-09-09-mailroom" },
    reviewRef: "BI-727D5FD9",
    intentEvidenceRefs: [
      {
        kind: "existing-behavior",
        ref: "docs/architecture/archetypes/pet-rescue-operating-model.md",
        summary: "§7c requirement 4: a reply must be possible from inside the product; today there is none.",
      },
    ],
  },
];
