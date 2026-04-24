import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendHarnessAdminEvent } from "./admin-event-log.js";

describe("admin-event-log", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup issues in test
      }
    }
  });

  it("writes structured scenario-flip events outside IntegrationToolCallLog", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dpf-harness-log-"));
    dirs.push(dir);

    const logPath = join(dir, "admin-events.ndjson");
    await appendHarnessAdminEvent(logPath, {
      kind: "scenario_flip",
      vendor: "adp",
      sessionId: "run-7",
      scenario: "happy-path",
      changedAt: "2026-04-24T22:00:00.000Z",
    });

    const lines = readFileSync(logPath, "utf8").trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      kind: "scenario_flip",
      vendor: "adp",
      sessionId: "run-7",
      scenario: "happy-path",
      changedAt: "2026-04-24T22:00:00.000Z",
    });
  });
});
