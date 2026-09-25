import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { validateMagicBytes } from "./file-upload";

const fixture = (name: string) => readFileSync(resolve(__dirname, "__fixtures__/office", name));

describe("validateMagicBytes (BI-65D65EC0)", () => {
  it("accepts a real Word 97-2003 file and a .docx that carries a .doc name", () => {
    expect(validateMagicBytes(fixture("plan.doc"), "doc")).toBe(true);
    expect(validateMagicBytes(fixture("plan-docx-renamed.doc"), "doc")).toBe(true);
  });

  it("still refuses bytes that match neither office container", () => {
    expect(validateMagicBytes(Buffer.from("plain text pretending"), "doc")).toBe(false);
    expect(validateMagicBytes(fixture("plan.doc"), "docx")).toBe(false);
  });
});
