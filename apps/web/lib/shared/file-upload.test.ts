import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { ACCEPTED_UPLOAD_EXTENSIONS } from "@/components/agent/uploadAgentAttachment";
import { ALLOWED_UPLOAD_EXTENSIONS, validateMagicBytes } from "./file-upload";

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

describe("converter-backed upload formats (BI-81524041)", () => {
  it("accepts legacy Excel and OpenDocument files, checked against their containers", () => {
    for (const ext of ["xls", "odt", "ods", "odp"]) expect(ALLOWED_UPLOAD_EXTENSIONS).toContain(ext);
    expect(validateMagicBytes(fixture("roster.xls"), "xls")).toBe(true);
    expect(validateMagicBytes(Buffer.from("name,breed"), "xls")).toBe(false);
    expect(validateMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), "ods")).toBe(true);
    expect(validateMagicBytes(fixture("roster.xls"), "odt")).toBe(false);
  });

  it("keeps the client picker's list identical to the server allow-list", () => {
    expect([...ACCEPTED_UPLOAD_EXTENSIONS].sort()).toEqual([...ALLOWED_UPLOAD_EXTENSIONS].sort());
  });
});
