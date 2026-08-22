import { describe, it, expect } from "vitest";
import {
  deriveStorefrontSetupModel,
  resolveSetupCapabilities,
  auditSetupSurface,
  type SetupModelInput,
} from "./setup-model";

const RESTAURANT_VOCAB = {
  itemsLabel: "Menu",
  singleItemLabel: "Item",
  portalLabel: "Venue Portal",
  stakeholderLabel: "Guests",
  teamLabel: "Staff",
  inboxLabel: "Reservations",
};

function restaurantInput(over: Partial<SetupModelInput> = {}): SetupModelInput {
  return {
    vocabulary: RESTAURANT_VOCAB,
    capabilities: resolveSetupCapabilities("food-hospitality"),
    config: { isPublished: false, hasTagline: true, hasHeroImage: true, hasContact: true },
    content: { activeItemCount: 12, visibleSectionCount: 4 },
    resources: { count: 6 },
    availability: { operatingHoursConfigured: true },
    serviceLines: {
      primary: {
        compositionId: "c-primary",
        name: "Restaurant",
        category: "food-hospitality",
        role: "primary",
        itemsGenerated: 12,
        sectionsGenerated: 4,
      },
      secondaries: [],
      retainedSecondaries: [],
    },
    ...over,
  };
}

describe("resolveSetupCapabilities", () => {
  it("gives a restaurant Tables + hours + inbox", () => {
    const cap = resolveSetupCapabilities("food-hospitality");
    expect(cap.supportsResources).toBe(true);
    expect(cap.resourceLabel).toBe("Tables");
    expect(cap.supportsHours).toBe(true);
    expect(cap.supportsInbox).toBe(true);
  });

  it("omits resources/hours for a non-booking retailer", () => {
    const cap = resolveSetupCapabilities("retail-goods");
    expect(cap.supportsResources).toBe(false);
    expect(cap.supportsHours).toBe(false);
    expect(cap.supportsInbox).toBe(true);
  });
});

describe("deriveStorefrontSetupModel", () => {
  it("produces restaurant-labeled task-first steps", () => {
    const model = deriveStorefrontSetupModel(restaurantInput());
    const keys = model.steps.map((s) => s.key);
    expect(keys).toEqual(["brand", "items", "resources", "hours", "inbox"]);
    const titles = model.steps.map((s) => s.title);
    expect(titles.some((t) => t.includes("Menu"))).toBe(true);
    expect(titles.some((t) => t.includes("Tables"))).toBe(true);
    expect(model.steps.find((s) => s.key === "inbox")?.title).toBe("Reservations");
  });

  it("does not append a fabricated singular to an already-plural nonprofit label", () => {
    const model = deriveStorefrontSetupModel(
      restaurantInput({
        vocabulary: {
          ...RESTAURANT_VOCAB,
          itemsLabel: "Campaigns & Appeals",
          singleItemLabel: "Campaign",
          portalLabel: "Supporter Hub",
          stakeholderLabel: "Supporters",
        },
        capabilities: resolveSetupCapabilities("nonprofit-community"),
      }),
    );

    expect(model.steps.find((step) => step.key === "items")?.title).toBe(
      "Campaigns & Appeals",
    );
  });

  it("marks steps complete/attention/not-started from real data", () => {
    const model = deriveStorefrontSetupModel(
      restaurantInput({
        config: { isPublished: false, hasTagline: false, hasHeroImage: false, hasContact: false },
        content: { activeItemCount: 0, visibleSectionCount: 0 },
        resources: { count: 0 },
        availability: { operatingHoursConfigured: false },
      }),
    );
    expect(model.steps.find((s) => s.key === "brand")?.status).toBe("attention");
    expect(model.steps.find((s) => s.key === "items")?.status).toBe("not-started");
    expect(model.steps.find((s) => s.key === "hours")?.status).toBe("attention");
    expect(model.summary.completeCount).toBe(0);
  });

  it("drops resources/hours steps for a non-booking archetype", () => {
    const model = deriveStorefrontSetupModel(
      restaurantInput({ capabilities: resolveSetupCapabilities("retail-goods") }),
    );
    const keys = model.steps.map((s) => s.key);
    expect(keys).not.toContain("resources");
    expect(keys).not.toContain("hours");
  });

  it("keeps advanced service lines hidden and counts them", () => {
    const model = deriveStorefrontSetupModel(
      restaurantInput({
        serviceLines: {
          primary: {
            compositionId: "c-primary",
            name: "Restaurant",
            category: "food-hospitality",
            role: "primary",
            itemsGenerated: 12,
            sectionsGenerated: 4,
          },
          secondaries: [
            {
              compositionId: "c-1",
              name: "Coffee Shop",
              category: "food-hospitality",
              role: "secondary",
              itemsGenerated: 5,
              sectionsGenerated: 2,
            },
          ],
          retainedSecondaries: [
            {
              compositionId: "c-2",
              name: "Auto Repair",
              category: "automotive-services",
              role: "secondary",
              itemsGenerated: 8,
              sectionsGenerated: 3,
              crossCategory: true,
            },
          ],
        },
      }),
    );
    expect(model.advanced.hidden).toBe(true);
    expect(model.advanced.activeServiceLineCount).toBe(1);
    expect(model.advanced.retainedServiceLineCount).toBe(1);
    expect(model.advanced.hasCrossCategory).toBe(true);
  });

  it("inventories generated content with recovery per group", () => {
    const model = deriveStorefrontSetupModel(
      restaurantInput({
        serviceLines: {
          primary: {
            compositionId: "c-primary",
            name: "Restaurant",
            category: "food-hospitality",
            role: "primary",
            itemsGenerated: 12,
            sectionsGenerated: 4,
          },
          secondaries: [
            {
              compositionId: "c-1",
              name: "Coffee Shop",
              category: "food-hospitality",
              role: "secondary",
              itemsGenerated: 5,
              sectionsGenerated: 2,
            },
          ],
          retainedSecondaries: [
            {
              compositionId: "c-2",
              name: "Auto Repair",
              category: "automotive-services",
              role: "secondary",
              itemsGenerated: 8,
              sectionsGenerated: 3,
              crossCategory: true,
            },
          ],
        },
      }),
    );
    const primary = model.inventory.find((g) => g.role === "primary")!;
    expect(primary.state).toBe("core");
    expect(primary.recoverable).toBe(false);
    expect(primary.recoveryLabel).toBeNull();

    const active = model.inventory.find((g) => g.compositionId === "c-1")!;
    expect(active.state).toBe("active");
    expect(active.recoverable).toBe(true);

    const retained = model.inventory.find((g) => g.compositionId === "c-2")!;
    expect(retained.state).toBe("retained");
    expect(retained.recoverable).toBe(true);
    expect(retained.crossCategory).toBe(true);
  });
});

describe("auditSetupSurface — the surface passes its own UX ceilings", () => {
  it("passes with a lean prose block and a collapsed 100-option add list", () => {
    const model = deriveStorefrontSetupModel(
      restaurantInput({
        serviceLines: {
          primary: {
            compositionId: "c-primary",
            name: "Restaurant",
            category: "food-hospitality",
            role: "primary",
            itemsGenerated: 12,
            sectionsGenerated: 4,
          },
          secondaries: [
            {
              compositionId: "c-1",
              name: "Coffee Shop",
              category: "food-hospitality",
              role: "secondary",
              itemsGenerated: 5,
              sectionsGenerated: 2,
            },
          ],
          retainedSecondaries: [],
        },
      }),
    );
    const report = auditSetupSurface(model, {
      route: "/storefront",
      prose:
        "Set up your venue portal. Work through each step, then publish when you are ready. " +
        "Advanced service lines stay hidden until you open them.",
      extraActions: [{ label: "Publish" }, { label: "Show advanced service lines" }],
      availableServiceLineCount: 100,
    });
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });
});
