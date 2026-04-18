import { describe, it, expect } from "vitest";
import { BrandPreview } from "./BrandPreview";

// Render tests use renderToStaticMarkup which is blocked by the repo-wide
// react/react-dom version mismatch; module contract only for now.
describe("BrandPreview (module contract)", () => {
  it("exports BrandPreview", () => {
    expect(typeof BrandPreview).toBe("function");
    expect(BrandPreview.name).toBe("BrandPreview");
  });
});
