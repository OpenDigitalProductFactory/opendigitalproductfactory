import { describe, expect, it } from "vitest";

import {
  evaluateHostPosture,
  hostPostureAdvice,
  parseHostPostureSnapshot,
  readHostPosture,
  HOST_POSTURE_RELATIVE_PATH,
} from "./host-posture";

const SNAPSHOT = {
  schemaVersion: 1,
  observedAt: "2026-11-09T01:46:30.000Z",
  platform: "macos",
  hasBattery: true,
  powerSource: "battery",
  acSleepMinutes: 0,
  dockerStartsAtLogin: true,
};

describe("parseHostPostureSnapshot", () => {
  it("accepts the snapshot the host start script writes", () => {
    expect(parseHostPostureSnapshot(SNAPSHOT)).toEqual(SNAPSHOT);
  });

  it("rejects anything that is not a version-1 snapshot", () => {
    expect(parseHostPostureSnapshot(null)).toBeNull();
    expect(parseHostPostureSnapshot({ ...SNAPSHOT, schemaVersion: 2 })).toBeNull();
    expect(parseHostPostureSnapshot({ ...SNAPSHOT, observedAt: "yesterday" })).toBeNull();
    expect(parseHostPostureSnapshot([])).toBeNull();
  });

  it("reads unknown fields as unknown rather than guessing", () => {
    const parsed = parseHostPostureSnapshot({ schemaVersion: 1, observedAt: SNAPSHOT.observedAt, platform: "macos" });
    expect(parsed).toMatchObject({ powerSource: null, acSleepMinutes: null, dockerStartsAtLogin: null, hasBattery: null });
  });
});

describe("evaluateHostPosture", () => {
  it("flags a laptop running on battery, with a plain fix step", () => {
    const view = evaluateHostPosture(parseHostPostureSnapshot(SNAPSHOT)!);
    const power = view.checks.find((check) => check.id === "ac-power")!;
    expect(power.state).toBe("attention");
    expect(power.fix).toMatch(/plugged in/i);
    expect(view.attentionCount).toBe(1);
  });

  it("flags sleep allowed on AC power and Docker not starting at sign-in", () => {
    const view = evaluateHostPosture(parseHostPostureSnapshot({ ...SNAPSHOT, powerSource: "ac", acSleepMinutes: 10, dockerStartsAtLogin: false })!);
    expect(view.checks.map((check) => [check.id, check.state])).toEqual([
      ["ac-power", "ok"],
      ["sleep-on-ac", "attention"],
      ["docker-at-login", "attention"],
    ]);
    expect(view.checks.find((check) => check.id === "sleep-on-ac")!.fix).toMatch(/System Settings/);
    expect(view.checks.find((check) => check.id === "docker-at-login")!.fix).toMatch(/Start Docker Desktop when you sign in/);
  });

  it("treats a Mac with no battery as always on AC power", () => {
    const view = evaluateHostPosture(parseHostPostureSnapshot({ ...SNAPSHOT, hasBattery: false, powerSource: "ac" })!);
    expect(view.checks.find((check) => check.id === "ac-power")!.state).toBe("ok");
  });

  it("reports unknown, with no fix, when the host could not be read", () => {
    const view = evaluateHostPosture(parseHostPostureSnapshot({ schemaVersion: 1, observedAt: SNAPSHOT.observedAt, platform: "macos" })!);
    expect(view.checks.every((check) => check.state === "unknown" && check.fix === null)).toBe(true);
    expect(view.attentionCount).toBe(0);
  });

  it("has no macOS checks for another host platform", () => {
    const view = evaluateHostPosture(parseHostPostureSnapshot({ ...SNAPSHOT, platform: "linux" })!);
    expect(view.checks).toEqual([]);
  });
});

describe("hostPostureAdvice", () => {
  it("returns only the fix steps that need attention", () => {
    const view = evaluateHostPosture(parseHostPostureSnapshot({ ...SNAPSHOT, dockerStartsAtLogin: false })!);
    expect(hostPostureAdvice(view)).toHaveLength(2);
    expect(hostPostureAdvice(null)).toEqual([]);
  });
});

describe("readHostPosture", () => {
  it("reads the snapshot from the mounted install directory", async () => {
    const paths: string[] = [];
    const view = await readHostPosture({
      hostRoot: "/host-dpf/",
      readText: async (path) => {
        paths.push(path);
        return JSON.stringify(SNAPSHOT);
      },
    });
    expect(paths).toEqual([`/host-dpf/${HOST_POSTURE_RELATIVE_PATH}`]);
    expect(view?.observedAt).toBe(SNAPSHOT.observedAt);
  });

  it("returns null when no snapshot has been written or it is unreadable", async () => {
    expect(await readHostPosture({ hostRoot: "/x", readText: async () => { throw new Error("ENOENT"); } })).toBeNull();
    expect(await readHostPosture({ hostRoot: "/x", readText: async () => "not json" })).toBeNull();
  });
});
