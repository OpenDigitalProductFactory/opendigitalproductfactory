import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Host free-space floor before builds start (BI-F3D191A2), measuring the
 * storage Docker actually writes to (BI-E3B738A9).
 *
 * WHY THIS DOES NOT LOOK AT A DRIVE LETTER
 *
 * The first version read `G:` and fell back to `C:` only when `G:` could not be
 * read, on the assumption that "the Docker data drive is often G: for this
 * setup". Operators put Docker's data wherever they like, on Windows, macOS or
 * Linux, and a remote or CI daemon has no host drive letter at all — so any
 * hardcoded letter is wrong on some install. It was wrong on the install that
 * found this: `G:` reported 1357 GB free and passed unconditionally while the
 * volume actually backing Docker had 77 GB left. A guard that always passes is
 * worse than no guard, because it reads as protection.
 *
 * TWO LIMITS, NOT ONE
 *
 * Docker Desktop stores everything in a virtual disk provisioned far larger
 * than the space the host can actually supply. Measured on that install: the
 * daemon's filesystem reported 765 GB available inside a ~1 TB virtual disk,
 * while the host volume holding that disk file had 77 GB. The disk grows into
 * host space on demand, so the real headroom is the SMALLER of the two, and a
 * build trusting the inside number can still fill the host — which is the
 * read-only filesystem and SIGBUS that killed Postgres on 2026-07-31 and caused
 * this floor to be specified in the first place.
 *
 * So: measure the daemon's own filesystem by asking the daemon, measure the
 * backing host volume where one exists, and gate on whichever is smaller.
 *
 * FAILING TO MEASURE IS NOT PASSING
 *
 * A probe that cannot run is infrastructure trouble, not evidence of free
 * space, and it must not read as a pass. It does not block the build either —
 * fail closed on safety, open on infrastructure — but it returns a warning the
 * caller prints, so an unmeasured host is visible rather than silent.
 */

const DEFAULT_FLOOR_GB = 20;
/** Tiny, widely cached image used only to run `df` against the daemon's storage. */
const DEFAULT_PROBE_IMAGE = "alpine";

const round2 = (value) => Math.round(value * 100) / 100;

function run(spawnSyncImpl, command, args) {
  const result = spawnSyncImpl(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return typeof result.stdout === "string" ? result.stdout : "";
}

/**
 * Free space on the filesystem the daemon writes to.
 *
 * A container's root filesystem IS the Docker storage filesystem, so `df` inside
 * a throwaway container reports it directly. That asks the daemon about its own
 * storage instead of guessing where the operator put it, and behaves the same on
 * WSL, macOS, native Linux and a remote daemon.
 */
export function measureDaemonFilesystem({
  spawnSyncImpl = spawnSync,
  probeImage = process.env.DPF_DISK_PROBE_IMAGE || DEFAULT_PROBE_IMAGE,
} = {}) {
  const stdout = run(spawnSyncImpl, "docker", [
    "run", "--rm", probeImage, "sh", "-c", "df -P / | tail -1",
  ]);
  if (stdout === null) return { error: "daemon filesystem probe did not run" };
  return parseDfLine(stdout, "Docker storage");
}

/** Parse one POSIX `df -P` row: Filesystem, 1K-blocks, Used, Available, Cap, Mount. */
export function parseDfLine(stdout, label) {
  const line = String(stdout).trim().split("\n").pop();
  if (!line) return { error: `${label}: no df output` };
  const parts = line.trim().split(/\s+/);
  const availableKb = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(availableKb)) return { error: `${label}: unreadable df output` };
  return { label, freeGb: round2(availableKb / 1024 / 1024) };
}

/**
 * Free space on the host volume backing the daemon's storage, when there is one.
 *
 * Native Linux/macOS daemons write straight to a host path, so the daemon's own
 * filesystem already IS the host volume and there is nothing further to check.
 * Docker Desktop keeps a virtual disk file instead, and that file's volume is
 * the real ceiling.
 */
export function measureHostBackingVolume({
  spawnSyncImpl = spawnSync,
  platform = process.platform,
  env = process.env,
  existsSyncImpl = existsSync,
} = {}) {
  const diskPath = resolveDataDiskPath({ platform, env, existsSyncImpl });
  if (!diskPath) return null;

  if (platform === "win32") {
    const drive = diskPath.slice(0, 1);
    const stdout = run(spawnSyncImpl, "powershell", [
      "-NoProfile", "-Command", `(Get-PSDrive ${drive}).Free / 1GB`,
    ]);
    if (stdout === null) return { error: `host volume ${drive}: could not be read` };
    const freeGb = Number.parseFloat(String(stdout).trim());
    if (!Number.isFinite(freeGb)) return { error: `host volume ${drive}: unreadable free space` };
    return { label: `host volume ${drive}:`, freeGb: round2(freeGb) };
  }

  const stdout = run(spawnSyncImpl, "df", ["-Pk", diskPath]);
  if (stdout === null) return { error: `host volume for ${diskPath} could not be read` };
  return parseDfLine(stdout, `host volume for ${diskPath}`);
}

/** Where Docker Desktop keeps its virtual data disk, or null when it writes to the host directly. */
export function resolveDataDiskPath({
  platform = process.platform,
  env = process.env,
  existsSyncImpl = existsSync,
} = {}) {
  const override = env.DPF_DOCKER_DATA_DISK;
  if (override) return existsSyncImpl(override) ? override : null;

  const candidates = [];
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(`${localAppData}\\Docker\\wsl\\disk\\docker_data.vhdx`);
      candidates.push(`${localAppData}\\Docker\\wsl\\data\\ext4.vhdx`);
      candidates.push(`${localAppData}\\Docker\\wsl\\main\\ext4.vhdx`);
    }
  } else if (platform === "darwin") {
    const home = env.HOME;
    if (home) {
      candidates.push(`${home}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`);
      candidates.push(`${home}/Library/Containers/com.docker.docker/Data/vms/0/Docker.raw`);
    }
  }
  return candidates.find((candidate) => existsSyncImpl(candidate)) ?? null;
}

/**
 * Decide from whatever could be measured. Pure, so the load-bearing rule —
 * gate on the smallest real number, never treat an unmeasured host as free — is
 * unit-tested without a daemon.
 */
export function decideDiskFloor({ measurements, floorGb }) {
  const measured = measurements.filter((m) => m && typeof m.freeGb === "number");
  const unreadable = measurements.filter((m) => m && m.error).map((m) => m.error);

  if (measured.length === 0) {
    const detail = unreadable.length > 0 ? unreadable.join("; ") : "no probe produced a reading";
    return {
      ok: true,
      warning: `Disk floor UNVERIFIED: ${detail}. Not treating this as free space; the build continues because an unrunnable probe is infrastructure, not evidence.`,
      measurements: [],
    };
  }

  const binding = measured.reduce((a, b) => (b.freeGb < a.freeGb ? b : a));
  const summary = measured.map((m) => `${m.label} ${m.freeGb}GB free`).join(", ");
  if (binding.freeGb < floorGb) {
    return {
      ok: false,
      binding,
      measurements: measured,
      message: `Build blocked: ${binding.label} has only ${binding.freeGb}GB free (minimum ${floorGb}GB). Measured ${summary}. Reclaim Docker disk before building.`,
    };
  }
  return { ok: true, binding, measurements: measured };
}

/**
 * Checks whether Docker has enough room to safely run a build.
 * BI-F3D191A2 set the floor; BI-E3B738A9 made it measure the right storage.
 */
export function checkHostDiskSpace({
  floorGb = process.env.DPF_MIN_DISK_GB ? Number.parseFloat(process.env.DPF_MIN_DISK_GB) : DEFAULT_FLOOR_GB,
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  env = process.env,
  existsSyncImpl = existsSync,
  probeImage,
} = {}) {
  const effectiveFloor = Number.isFinite(floorGb) ? floorGb : DEFAULT_FLOOR_GB;
  const measurements = [
    measureDaemonFilesystem({ spawnSyncImpl, probeImage }),
    measureHostBackingVolume({ spawnSyncImpl, platform, env, existsSyncImpl }),
  ];
  return decideDiskFloor({ measurements, floorGb: effectiveFloor });
}
