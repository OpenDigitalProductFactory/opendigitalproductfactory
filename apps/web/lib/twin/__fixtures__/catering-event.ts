import type { TwinSnapshot } from "@/components/twin";

/** Pressure fixture for a catering event-readiness operation. */
export function cateringEventFixture(): TwinSnapshot {
  return {
    capacityChips: [
      { key: "guests", label: "Guests committed", value: 180, intent: "info" },
      { key: "prep", label: "Kitchen prep capacity", value: "84%", intent: "warning" },
      { key: "delivery", label: "Delivery/setup readiness", value: "2 of 3", intent: "warning" },
      { key: "deposit", label: "Deposit status", value: "Paid", intent: "success" },
    ],
    zones: [
      {
        key: "prep",
        meta: "Saturday wedding · 180 guests",
        units: [
          { key: "hot-line", label: "Hot line", state: "At capacity", intent: "warning" },
          { key: "cold-prep", label: "Cold prep", state: "Ready", intent: "success" },
          { key: "van-2", label: "Delivery van 2", state: "Loading", intent: "info" },
        ],
      },
    ],
    workItems: [
      { key: "event-1", label: "Rivera wedding · 180 guests", sublabel: "Saturday · service 5:30 PM" },
    ],
    queues: [
      {
        key: "menu",
        items: [{ key: "menu-1", label: "Final menu approval", waiting: "due today" }],
      },
      {
        key: "staffing",
        items: [{ key: "staff-1", label: "2 event staff unassigned", waiting: "1 day" }],
      },
      {
        key: "delivery",
        items: [{ key: "route-1", label: "Confirm loading and setup window", waiting: "tomorrow" }],
      },
      { key: "deposits", items: [] },
    ],
    cog: {
      proposal: "Move dessert prep to the cold line and assign two event staff",
      signals: ["180 guests", "hot line 84%", "2 staff unassigned", "setup 3:00 PM"],
      confirmLabel: "Review event plan",
    },
    presence: [
      { name: "Maya", kind: "human", focus: "event lead" },
      { name: "AI event coordinator", kind: "ai", focus: "readiness watch" },
    ],
    feed: [],
    quests: [
      {
        key: "quest-staff",
        title: "Event staffing is short",
        detail: "Two service roles remain unassigned before loading",
        intent: "warning",
      },
    ],
    utility: [
      { key: "invoice", label: "Invoice readiness", value: "Balance due after event", intent: "info" },
    ],
  };
}
