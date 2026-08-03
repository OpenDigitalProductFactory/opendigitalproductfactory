import { spawnSync } from "node:child_process";

/**
 * Checks if the host has enough free disk space to safely run a build.
 * BI-F3D191A2: Enforce a host free-space floor before builds start
 */
export function checkHostDiskSpace({
  floorGb = process.env.DPF_MIN_DISK_GB ? parseFloat(process.env.DPF_MIN_DISK_GB) : 20,
  platform = process.platform,
  spawnSyncImpl = spawnSync,
} = {}) {
  // On Windows, the Docker data drive is often G: for this setup, or C: if not using a dedicated drive.
  if (platform === "win32") {
    // Try to find the drive. We'll default to checking G:, then C: if G: is not found.
    let driveToCheck = "G";
    let psArgs = ["-NoProfile", "-Command", `(Get-PSDrive ${driveToCheck}).Free / 1GB`];
    let result = spawnSyncImpl("powershell", psArgs, { encoding: "utf8" });
    
    if (result.error || result.status !== 0) {
      driveToCheck = "C";
      psArgs = ["-NoProfile", "-Command", `(Get-PSDrive ${driveToCheck}).Free / 1GB`];
      result = spawnSyncImpl("powershell", psArgs, { encoding: "utf8" });
    }

    if (!result.error && result.status === 0) {
      const freeGb = Math.round(parseFloat(result.stdout.trim()) * 100) / 100;
      if (!isNaN(freeGb) && freeGb < floorGb) {
        return {
          ok: false,
          message: `Build blocked: host disk ${driveToCheck}: has only ${freeGb}gb free (minimum ${floorGb}GB required). Run Docker disk cleanup first.`,
        };
      }
    }
  } else {
    // Linux/macOS equivalent using df
    const result = spawnSyncImpl("df", ["-k", "/"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      const lines = result.stdout.trim().split("\n");
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        // df -k returns 1K-blocks, Used, Available, Use%, Mounted on
        const freeKb = parseInt(parts[3], 10);
        if (!isNaN(freeKb)) {
          const freeGb = Math.round((freeKb / 1024 / 1024) * 100) / 100;
          if (freeGb < floorGb) {
            return {
              ok: false,
              message: `Build blocked: host disk / has only ${freeGb}gb free (minimum ${floorGb}GB required). Run Docker disk cleanup first.`,
            };
          }
        }
      }
    }
  }

  return { ok: true };
}
