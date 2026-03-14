import { describe, expect, it } from "vitest";
import { normalizePriorityClass, slugifyReferenceModelName } from "./reference-model-import.js";

describe("reference model import helpers", () => {
  describe("normalizePriorityClass", () => {
    it("maps must and shall to required", () => {
      expect(normalizePriorityClass("Must align to business objectives")).toBe("required");
      expect(normalizePriorityClass("Shall map to Enterprise Architecture")).toBe("required");
    });

    it("maps should to recommended and may to optional", () => {
      expect(normalizePriorityClass("Should review standards")).toBe("recommended");
      expect(normalizePriorityClass("May conduct an environmental scan")).toBe("optional");
    });

    it("returns null for text without a normative prefix", () => {
      expect(normalizePriorityClass("Internal analysis to assess strengths and weaknesses")).toBeNull();
    });
  });

  describe("slugifyReferenceModelName", () => {
    it("builds a stable slug from name and version", () => {
      expect(slugifyReferenceModelName("IT4IT", "3.0.1")).toBe("it4it_v3_0_1");
      expect(slugifyReferenceModelName("TM Forum", "24.0")).toBe("tm_forum_v24_0");
    });
  });
});
