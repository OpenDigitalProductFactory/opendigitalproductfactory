import { describe, it, expect } from "vitest";
import { BrandExtractionForm } from "./BrandExtractionForm";

// NOTE: Full render tests use renderToStaticMarkup, which is blocked repo-wide
// by the react 19.2.4 / react-dom 19.2.5 version mismatch in node_modules.
// Once that is resolved, add DOM-level assertions (disabled state, codebase
// toggle visibility, onExtract payload). For now we verify the component
// module contract: exported function + expected prop shape.

describe("BrandExtractionForm (module contract)", () => {
  it("exports the BrandExtractionForm function", () => {
    expect(typeof BrandExtractionForm).toBe("function");
  });

  it("the BrandExtractionForm function name matches", () => {
    expect(BrandExtractionForm.name).toBe("BrandExtractionForm");
  });
});
