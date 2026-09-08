// Structural guard: every field the evidence tool advertises must survive to
// the persisted payload.
//
// This exists because the identical seam already shipped broken once: the
// scope-claim handler advertised `workShape`, never read it, and returned
// success while dropping the claim. `stageKey` carries more weight — a dropped
// stageKey means evidence is recorded, the tool reports success, and the stage
// silently never advances, which is the defect BI-76B35820 exists to remove.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const packSource = readFileSync(
  join(__dirname, "..", "mcp", "packs", "work-capsules-pack.ts"),
  "utf8",
);
const handlerSource = readFileSync(join(__dirname, "mcp-handlers.ts"), "utf8");

describe("record_workroom_evidence schema/handler parity", () => {
  it("advertises stageKey", () => {
    const schema = packSource.slice(packSource.indexOf('name: "record_workroom_evidence"'));
    expect(schema.slice(0, 1600)).toContain("stageKey");
  });

  it("reads stageKey in the handler rather than silently dropping it", () => {
    const handler = handlerSource.slice(handlerSource.indexOf("export async function recordCapsuleEvidenceTool"));
    const body = handler.slice(0, 2400);
    expect(body).toContain('stringParam(params, "stageKey")');
    expect(body).toContain("evidence.stageKey");
  });
});
