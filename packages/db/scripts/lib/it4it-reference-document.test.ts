import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { IT4IT_REFERENCE_JSON_PATH, parseIt4itReferenceDocument } from "../../src/it4it-reference-data.js";
import {
  IT4IT_WORKBOOK_PATH,
  buildIt4itReferenceDocument,
  describeWorkbookIdentity,
} from "./it4it-reference-document.js";

// BI-B470264D AC-3: drift check between the LFS-tracked IT4IT workbook and the
// committed JSON the seed reads.
//
// The workbook is Git LFS content. A checkout without LFS holds a ~130-byte
// pointer whose `oid sha256:` IS the sha256 of the real bytes, so the identity
// check runs with or without LFS. Where the real bytes are present, the rows
// are also re-derived and compared, which catches a generator change that was
// not re-run.

const REGENERATE = "pnpm --filter @dpf/db exec tsx scripts/generate-it4it-reference-json.ts";

const workbookBytes = readFileSync(IT4IT_WORKBOOK_PATH);
const workbook = describeWorkbookIdentity(workbookBytes);
const committed = parseIt4itReferenceDocument(readFileSync(IT4IT_REFERENCE_JSON_PATH, "utf8"));

describe("IT4IT reference JSON drift check", () => {
  it("was generated from the workbook that is checked in", () => {
    expect(
      { sha256: committed.source.sha256, size: committed.source.size },
      `docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx changed without regenerating ${IT4IT_REFERENCE_JSON_PATH}. Run: ${REGENERATE}`,
    ).toEqual({ sha256: workbook.sha256, size: workbook.size });
  });

  it.skipIf(workbook.kind === "lfs-pointer")(
    "matches rows re-derived from the workbook bytes (needs LFS content)",
    async () => {
      const rebuilt = await buildIt4itReferenceDocument();
      expect(rebuilt, `Committed JSON is stale. Run: ${REGENERATE}`).toEqual(committed);
    },
  );
});

describe("describeWorkbookIdentity", () => {
  it("reads the sha256 and size from a Git LFS pointer", () => {
    const pointer = Buffer.from(
      "version https://git-lfs.github.com/spec/v1\noid sha256:" + "ab".repeat(32) + "\nsize 50044\n",
    );
    expect(describeWorkbookIdentity(pointer)).toEqual({ kind: "lfs-pointer", sha256: "ab".repeat(32), size: 50044 });
  });

  it("hashes real workbook bytes", () => {
    const bytes = Buffer.from("PK\u0003\u0004 not really a workbook");
    const identity = describeWorkbookIdentity(bytes);
    expect(identity.kind).toBe("content");
    expect(identity.size).toBe(bytes.length);
    expect(identity.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses bytes that are neither a zip nor an LFS pointer", () => {
    expect(() => describeWorkbookIdentity(Buffer.from("hello"))).toThrow(/neither/);
  });
});
