// Host posture (BI-3E2F87FA, WWMD DI-1984B00059B3).
//
// WHY THIS EXISTS: on 2026-11-08..10 the platform was down for about 36 hours.
// The Mac running it restarted for a macOS update and later slept on battery,
// and nothing on the install said the host was set up in a way that lets that
// happen. The portal runs in a Linux container and cannot read the Mac's power
// settings, so the shipped host start script (scripts/installer/host-posture.mjs,
// run by dpf-start.consumer.sh at sign-in) reads them read-only and writes a
// small snapshot into the install directory, which the portal mounts at
// /host-dpf. This module reads that snapshot and turns it into three checks with
// plain fix steps.
//
// Advice only. Nothing here, or in the host script, changes an OS setting: the
// operator makes each change in System Settings or Docker Desktop.

import { readFile } from "node:fs/promises";

/** Where the host start script writes the snapshot, relative to the install directory. */
export const HOST_POSTURE_RELATIVE_PATH = "data/host/posture.json";

export interface HostPostureSnapshotV1 {
  schemaVersion: 1;
  /** When the host script read the settings (ISO). Posture can change after this. */
  observedAt: string;
  platform: "macos" | "linux" | "windows" | "unknown";
  /** Whether the host has a battery at all; a desktop Mac has none. */
  hasBattery: boolean | null;
  powerSource: "ac" | "battery" | null;
  /** pmset AC-power `sleep` value in minutes; 0 means the Mac never sleeps on AC. */
  acSleepMinutes: number | null;
  /** Docker Desktop's "Start Docker Desktop when you sign in" setting. */
  dockerStartsAtLogin: boolean | null;
}

export type HostPostureCheckId = "ac-power" | "sleep-on-ac" | "docker-at-login";

export interface HostPostureCheck {
  id: HostPostureCheckId;
  label: string;
  state: "ok" | "attention" | "unknown";
  /** What was observed, in plain words. */
  detail: string;
  /** The step the operator takes, or null when nothing needs doing (or nothing is known). */
  fix: string | null;
}

export interface HostPostureView {
  observedAt: string;
  platform: HostPostureSnapshotV1["platform"];
  checks: HostPostureCheck[];
  attentionCount: number;
}

const PLATFORMS = new Set(["macos", "linux", "windows", "unknown"]);

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Validate the JSON the host script wrote. Anything unexpected reads as unknown. */
export function parseHostPostureSnapshot(value: unknown): HostPostureSnapshotV1 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return null;
  if (typeof raw.observedAt !== "string" || Number.isNaN(Date.parse(raw.observedAt))) return null;
  const platform = typeof raw.platform === "string" && PLATFORMS.has(raw.platform)
    ? (raw.platform as HostPostureSnapshotV1["platform"])
    : "unknown";
  const acSleep = typeof raw.acSleepMinutes === "number" && Number.isFinite(raw.acSleepMinutes) && raw.acSleepMinutes >= 0
    ? raw.acSleepMinutes
    : null;
  return {
    schemaVersion: 1,
    observedAt: raw.observedAt,
    platform,
    hasBattery: boolOrNull(raw.hasBattery),
    powerSource: raw.powerSource === "ac" || raw.powerSource === "battery" ? raw.powerSource : null,
    acSleepMinutes: acSleep,
    dockerStartsAtLogin: boolOrNull(raw.dockerStartsAtLogin),
  };
}

const UNKNOWN_DETAIL = "This could not be read from the computer.";

function acPowerCheck(snapshot: HostPostureSnapshotV1): HostPostureCheck {
  const label = "Plugged in to power";
  if (snapshot.hasBattery === false) {
    return { id: "ac-power", label, state: "ok", detail: "This Mac has no battery, so it always runs on power.", fix: null };
  }
  if (snapshot.powerSource === "ac") {
    return { id: "ac-power", label, state: "ok", detail: "The Mac was running on its power adapter.", fix: null };
  }
  if (snapshot.powerSource === "battery") {
    return {
      id: "ac-power",
      label,
      state: "attention",
      detail: "The Mac was running on battery. On battery it goes to sleep when idle, and the platform stops serving while it sleeps.",
      fix: "Keep this Mac plugged in to its power adapter.",
    };
  }
  return { id: "ac-power", label, state: "unknown", detail: UNKNOWN_DETAIL, fix: null };
}

function sleepOnAcCheck(snapshot: HostPostureSnapshotV1): HostPostureCheck {
  const label = "Never sleeps on power";
  if (snapshot.acSleepMinutes === null) {
    return { id: "sleep-on-ac", label, state: "unknown", detail: UNKNOWN_DETAIL, fix: null };
  }
  if (snapshot.acSleepMinutes === 0) {
    return { id: "sleep-on-ac", label, state: "ok", detail: "The Mac does not go to sleep while it is on power.", fix: null };
  }
  return {
    id: "sleep-on-ac",
    label,
    state: "attention",
    detail: `The Mac goes to sleep after ${snapshot.acSleepMinutes} minutes idle, even on power.`,
    fix: "In System Settings, open Battery, then Options, and turn on \"Prevent automatic sleeping on power adapter when the display is off\". On a Mac without a battery this is under System Settings, Energy.",
  };
}

function dockerAtLoginCheck(snapshot: HostPostureSnapshotV1): HostPostureCheck {
  const label = "Docker starts at sign-in";
  if (snapshot.dockerStartsAtLogin === null) {
    return { id: "docker-at-login", label, state: "unknown", detail: UNKNOWN_DETAIL, fix: null };
  }
  if (snapshot.dockerStartsAtLogin) {
    return { id: "docker-at-login", label, state: "ok", detail: "Docker Desktop starts when you sign in to the Mac.", fix: null };
  }
  return {
    id: "docker-at-login",
    label,
    state: "attention",
    detail: "Docker Desktop does not start on its own after the Mac restarts.",
    fix: "Open Docker Desktop, go to Settings, then General, and turn on \"Start Docker Desktop when you sign in to your computer\".",
  };
}

/** Pure: the checks for one snapshot. Only macOS hosts have checks today. */
export function evaluateHostPosture(snapshot: HostPostureSnapshotV1): HostPostureView {
  const checks = snapshot.platform === "macos"
    ? [acPowerCheck(snapshot), sleepOnAcCheck(snapshot), dockerAtLoginCheck(snapshot)]
    : [];
  return {
    observedAt: snapshot.observedAt,
    platform: snapshot.platform,
    checks,
    attentionCount: checks.filter((check) => check.state === "attention").length,
  };
}

/** The fix steps that need doing, for a downtime item's explanation. */
export function hostPostureAdvice(view: HostPostureView | null): string[] {
  if (!view) return [];
  return view.checks.flatMap((check) => (check.state === "attention" && check.fix ? [check.fix] : []));
}

/** Read and evaluate the snapshot from the mounted install directory; null when none is there. */
export async function readHostPosture(options: {
  hostRoot?: string;
  readText?: (path: string) => Promise<string>;
} = {}): Promise<HostPostureView | null> {
  const hostRoot = (options.hostRoot ?? process.env.DPF_HOST_INSTALL_PATH_IN_CONTAINER ?? "/host-dpf").replace(/[\\/]+$/, "");
  const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
  try {
    const snapshot = parseHostPostureSnapshot(JSON.parse(await readText(`${hostRoot}/${HOST_POSTURE_RELATIVE_PATH}`)));
    return snapshot ? evaluateHostPosture(snapshot) : null;
  } catch {
    return null;
  }
}
