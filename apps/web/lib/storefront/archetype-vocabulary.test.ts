import { describe, expect, it } from "vitest";

import { getVocabulary } from "./archetype-vocabulary";

describe("archetype vocabulary", () => {
  // BI-35753C53 — DPF's own archetype is software-platform. With no entry it fell to the
  // default and the storefront rendered "Items & items".
  it("gives software-platform a real item vocabulary instead of the generic default", () => {
    const vocab = getVocabulary("software-platform");
    expect(vocab.itemsLabel).toBe("Products");
    expect(vocab.singleItemLabel).toBe("Product");
    // The tell of the bug: the generic default labels.
    expect(vocab.itemsLabel).not.toBe("Items");
    expect(vocab.singleItemLabel).not.toBe("Item");
  });

  it("still falls back to the default for an unknown category", () => {
    const vocab = getVocabulary("no-such-category");
    expect(vocab.itemsLabel).toBe("Items");
  });

  it("lets a custom vocabulary override the software-platform labels", () => {
    const vocab = getVocabulary("software-platform", { itemsLabel: "Modules" });
    expect(vocab.itemsLabel).toBe("Modules");
    expect(vocab.singleItemLabel).toBe("Product");
  });
});
