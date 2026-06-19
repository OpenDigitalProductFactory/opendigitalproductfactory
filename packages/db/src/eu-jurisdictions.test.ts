import { describe, it, expect } from "vitest";
import {
  EU_MEMBER_STATES,
  EEA_EFTA_STATES,
  EEA_STATES,
  isEuMember,
  isEeaState,
  isThirdCountryForCada,
  CADA_AFFECTED,
} from "./eu-jurisdictions";

describe("eu-jurisdictions", () => {
  it("has the 27 EU member states and 3 EEA-EFTA states", () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(EEA_EFTA_STATES).toHaveLength(3);
    expect(EEA_STATES).toHaveLength(30);
  });

  it("uses well-formed, unique, uppercase ISO2 codes", () => {
    const codes = EEA_STATES.map((s) => s.iso2);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("recognises EU members case-insensitively", () => {
    expect(isEuMember("FR")).toBe(true);
    expect(isEuMember("de")).toBe(true);
    expect(isEuMember(" ES ")).toBe(true);
    expect(isEuMember("US")).toBe(false);
    expect(isEuMember("NO")).toBe(false); // EEA but not EU
  });

  it("treats EEA-EFTA states as EEA but not EU", () => {
    expect(isEeaState("NO")).toBe(true);
    expect(isEeaState("IS")).toBe(true);
    expect(isEuMember("NO")).toBe(false);
  });

  it("classifies third countries for CADA by EEA membership", () => {
    expect(isThirdCountryForCada("US")).toBe(true);
    expect(isThirdCountryForCada("GB")).toBe(true);
    expect(isThirdCountryForCada("DE")).toBe(false);
    expect(isThirdCountryForCada("NO")).toBe(false);
    expect(CADA_AFFECTED.isThirdCountry("CH")).toBe(true);
  });
});
