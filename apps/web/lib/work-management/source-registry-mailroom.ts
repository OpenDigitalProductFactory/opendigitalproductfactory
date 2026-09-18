// Mailroom queue room source definition (design 2026-09-09 §4.3, BI-9BD223B1).
// Split out of source-registry.ts to keep that module under its size ceiling;
// it is spread into WORK_CASE_SOURCE_REGISTRY exactly like an inline entry.

import type { WorkCaseSourceRegistryEntry } from "./source-registry";
import { OBSERVED_RECEIPT_POLICY, SCHEDULED_TRANSITIONS, STANDING_ROOM_PROJECTION } from "./source-registry-shared";

export const MAILROOM_QUEUE_SOURCE_ENTRY = {
    // Mailroom queue room (design 2026-09-09 §4.3, BI-9BD223B1). A standing room per
    // queue key — every message the Mailroom assigns to that queue lands here as an
    // observed external event for the queue's responsible role to acknowledge and
    // answer. Observed receipts: arrival is evidence about transport, never an action;
    // the consequential act (a reply) is its own approved draft. Decision scope is the
    // customer's own correspondence (WWWD).
    sourceKey: "mailroom-queue",
    definitionVersion: 1,
    displayLabel: "Mailroom queue",
    owningArea: "operations",
    domainCategory: "correspondence",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the queue's room title (e.g. Veterinary correspondence).",
    summaryProjection: "Use the count of unacknowledged items, the oldest past its window, and today's arrivals by reason.",
    supportedTransitions: SCHEDULED_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: STANDING_ROOM_PROJECTION,
    trigger: {
      kind: "event",
      signal: "mailroom-item-routed",
      description: "A triaged message routed to this queue wakes the room.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "unacknowledged-items", label: "Items nobody has acknowledged", bindingKey: "obligations-status" },
      { key: "acknowledge-lag", label: "Time from arrival to acknowledgement", bindingKey: "lead-time" },
    ],
} as const satisfies WorkCaseSourceRegistryEntry;
