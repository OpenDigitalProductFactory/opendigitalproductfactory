import type { TwinSnapshot } from "@/components/twin";

/** Pressure fixture for a bakery production-and-fulfilment operation. */
export function bakeryProductionFixture(): TwinSnapshot {
  return {
    capacityChips: [
      { key: "bake", label: "Bake capacity", value: "3 of 4 batches", intent: "warning" },
      { key: "due", label: "Orders due", value: 11, intent: "info" },
      { key: "pickup", label: "Pickup/delivery readiness", value: "8 ready", intent: "success" },
      { key: "allergens", label: "Allergen holds", value: 1, intent: "danger" },
    ],
    zones: [
      {
        key: "production",
        meta: "Morning bake · 4-batch capacity",
        units: [
          { key: "oven-1", label: "Deck oven", state: "Batch 3", intent: "info" },
          { key: "oven-2", label: "Convection oven", state: "Available", intent: "success" },
          { key: "finishing", label: "Cake finishing", state: "2 queued", intent: "warning" },
        ],
      },
    ],
    workItems: [
      { key: "order-1", label: "Chen birthday cake", sublabel: "Custom specification · pickup 3:00 PM" },
      { key: "order-2", label: "Office pastry order", sublabel: "Delivery · 24 pieces" },
    ],
    queues: [
      {
        key: "production",
        items: [{ key: "order-1", label: "Custom cake finishing", waiting: "due in 2h" }],
      },
      {
        key: "fulfilment",
        items: [{ key: "order-2", label: "Pack delivery order", waiting: "route 11:30 AM" }],
      },
      {
        key: "allergens",
        items: [{ key: "allergen-1", label: "Confirm nut-free ingredients", waiting: "before bake" }],
      },
      {
        key: "balances",
        items: [{ key: "balance-1", label: "Wedding cake balance due", waiting: "due today" }],
      },
    ],
    cog: {
      proposal: "Use the convection oven for the pastry batch after allergen review",
      signals: ["one oven available", "pickup 3:00 PM", "allergen hold"],
      confirmLabel: "Review production plan",
    },
    presence: [
      { name: "Nia", kind: "human", focus: "finishing" },
      { name: "AI production coordinator", kind: "ai", focus: "promise watch" },
    ],
    feed: [],
    quests: [
      {
        key: "quest-allergen",
        title: "One order needs allergen review",
        detail: "Ingredient confirmation is required before the batch starts",
        intent: "danger",
      },
    ],
    utility: [
      { key: "balance", label: "Balances due", value: "$420", intent: "warning" },
    ],
  };
}
