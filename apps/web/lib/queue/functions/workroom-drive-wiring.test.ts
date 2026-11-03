// The producer must actually be called (BI-76B35820).
//
// This guard exists because the defect shipped in the very PR that fixes the
// pattern: `loadRecordedEvidence` was imported and never invoked, so
// `recordedEvidence` was declared, read, and never populated — evidence always
// `[]`, no receipt ever earned, the fix dead on arrival. A scripted edit matched
// nothing and failed silently; a code-quality bot caught it, not the compiler
// and not me.
//
// It is the twelfth read-with-no-writer in this program. The structural answer
// is a test that fails when the wiring is absent rather than a promise to look
// harder.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const drive = readFileSync(join(__dirname, "workroom-drive.ts"), "utf8");

describe("workroom-drive wiring", () => {
  it("invokes loadRecordedEvidence, not merely imports it", () => {
    expect(drive).toContain("await loadRecordedEvidence(");
  });

  it("populates recordedEvidence on the rooms it drives", () => {
    expect(drive).toMatch(/recordedEvidence:\s*evidenceByRoom\.get/);
  });

  it("uses every loader it imports from workroom-drive-data", () => {
    // The real defect is an identifier that appears ONLY in the import: declared,
    // never referenced, so its producer never runs. Passing a function as a value
    // (`?? reconcileStandingRoomNesting`) is legitimate use, so this checks for a
    // reference outside the import rather than a call.
    const statement = drive.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/workroom-drive-data";/);
    const imported = (statement?.[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !name.startsWith("type "));
    expect(imported.length).toBeGreaterThan(0);
    const body = drive.replace(statement?.[0] ?? "", "");
    for (const name of imported) {
      expect(body, `${name} is imported but never referenced`).toContain(name);
    }
  });
});

// BI-1DDCE164: the live loader dropped the objective and the bound item, so every
// live stage brief went out with no subject; only test rooms carried one.
describe("workroom-drive live loader carries the room's subject", () => {
  it("maps the objective and the bound backlog item key onto the driven room", () => {
    expect(drive).toMatch(/objective:\s*row\.objective/);
    expect(drive).toMatch(/workItemKey:\s*workItemKeyOf\(/);
  });

  it("stops the stage tasks of rooms the drive no longer selects", () => {
    expect(drive).toContain("deactivateUndrivenRoomTasks(");
  });
});
