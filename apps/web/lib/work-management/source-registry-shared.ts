// Shared source-registry policies (split from source-registry.ts for its size
// ceiling; imported by both the registry and the per-domain entry modules so
// no value import cycles back into the registry at module-init time).

import type { WorkCaseActionVerb } from "./case-types";
import type { WorkCaseReceiptPolicy, WorkCaseRoomProjectionPolicy } from "./source-registry";

type WorkCaseSupportedTransition = WorkCaseActionVerb;

export const SCHEDULED_TRANSITIONS = [
  "claim",
  "pause",
  "needs-input",
  "resume",
  "verify",
  "complete",
  "cancel",
  "open-cycle",
  "pause-cycle",
  "verify-cycle",
  "complete-cycle",
  "carry-over",
  "renew",
  "split",
  "archive",
] as const satisfies readonly WorkCaseSupportedTransition[];

export const OBSERVED_RECEIPT_POLICY = {
  defaultReceiptKind: "observed-event",
  receiptRequiredForConsequentialTransition: true,
} as const satisfies WorkCaseReceiptPolicy;

export const STANDING_ROOM_PROJECTION = {
  mode: "standing",
  cycleCarrierPrecedence: ["work-item", "work-capsule", "task-run"],
  outcomePacket: {
    requiredCategories: ["receipts", "evidence"],
  },
} as const satisfies WorkCaseRoomProjectionPolicy;
