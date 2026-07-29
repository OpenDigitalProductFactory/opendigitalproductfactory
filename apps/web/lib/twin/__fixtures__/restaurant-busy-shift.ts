import type { TwinSnapshot } from "@/components/twin";

/**
 * Contract-level pressure fixture for the shared Operations hot path.
 * Persistence and domain derivation remain owned by the P3 restaurant resource
 * model; this fixture makes the P2 renderer/selectors carry every busy-shift
 * state that model must later supply.
 */
export function restaurantBusyShiftFixture(): TwinSnapshot {
  return {
    capacityChips: [
      { key: "tables-open", label: "Tables open", value: 2, intent: "warning" },
      { key: "covers-seated", label: "Covers seated", value: 38, intent: "info" },
      { key: "waitlist", label: "Waitlist", value: 3, intent: "danger" },
    ],
    zones: [
      {
        key: "dining-room",
        meta: "12 tables · 48 covers",
        units: [
          {
            key: "table-1",
            label: "Table 1",
            state: "Available",
            intent: "success",
            owner: { name: "Alex", kind: "human" },
          },
          {
            key: "table-2",
            label: "Table 2",
            state: "Seated",
            intent: "info",
            owner: { name: "Alex", kind: "human" },
            sublabel: "Party of 4 · ordered",
          },
          {
            key: "table-3",
            label: "Table 3",
            state: "Dirty",
            intent: "warning",
            owner: { name: "Alex", kind: "human" },
            sublabel: "Clear before next seating",
          },
          {
            key: "table-4",
            label: "Table 4",
            state: "Blocked",
            intent: "danger",
            sublabel: "Chair repair",
          },
          {
            key: "table-5-6",
            label: "Tables 5 + 6",
            state: "Combined",
            intent: "info",
            owner: { name: "Alex", kind: "human" },
            sublabel: "Party of 8 · entrees",
          },
          {
            key: "table-7",
            label: "Table 7",
            state: "Paid",
            intent: "success",
            owner: { name: "Sam", kind: "human" },
            sublabel: "Turning in 4m",
          },
          {
            key: "table-8",
            label: "Table 8",
            state: "Turning soon",
            intent: "warning",
            owner: { name: "Alex", kind: "human" },
            sublabel: "12m late · Party of 4",
          },
        ],
      },
    ],
    workItems: [
      {
        key: "booking-lee",
        label: "Lee party · 4 covers",
        sublabel: "Reservation · 18:30",
      },
      {
        key: "walkin-rivera",
        label: "Rivera party · 3 covers",
        sublabel: "Walk-in · waiting 14m",
      },
    ],
    queues: [
      {
        key: "waitlist",
        items: [
          {
            key: "walkin-rivera",
            label: "Rivera · 3",
            waiting: "14m",
            suggestion: "Table 1 after server rotation check",
          },
          { key: "walkin-patel", label: "Patel · 2", waiting: "7m" },
        ],
      },
      {
        key: "reservations",
        items: [
          { key: "booking-lee", label: "Lee · 4", waiting: "in 9m" },
        ],
      },
    ],
    cog: {
      proposal: "Seat Rivera at Table 1 after checking Alex’s five-table load",
      signals: ["14m wait", "Table 1 fits", "server imbalance"],
      confirmLabel: "Assign table",
    },
    presence: [
      { name: "Alex", kind: "human", focus: "5 tables" },
      { name: "Sam", kind: "human", focus: "1 table" },
      { name: "AI host", kind: "ai", focus: "rotation watch" },
    ],
    feed: [
      {
        key: "feed-1",
        actor: { name: "Sam", kind: "human" },
        action: "marked Table 7 paid",
      },
    ],
    quests: [
      {
        key: "quest-late-turn",
        title: "Table 8 is turning late",
        detail: "Reservation pressure begins in 9 minutes",
        intent: "warning",
      },
    ],
    utility: [
      { key: "rotation", label: "Server load", value: "Alex 5 · Sam 1", intent: "warning" },
    ],
  };
}
