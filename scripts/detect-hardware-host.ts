#!/usr/bin/env -S pnpm exec tsx
// Host hardware detection for macOS and Linux, run BEFORE
// `docker compose up` to populate the DPF_HOST_PROFILE env var that
// docker-entrypoint.sh + scripts/detect-hardware.ts (container-side)
// consume to populate PlatformConfig in Postgres.
//
// Mirror of the hardware-detection block in install-dpf.ps1
// (lines 1038-1118), in TypeScript, for use by:
//   - scripts/setup.sh  (contributor flow on macOS / Linux)
//   - install-dpf.sh    (end-user installer; lands in Phase 7)
//   - manual: `pnpm exec tsx scripts/detect-hardware-host.ts`
//
// Output: a single JSON object on stdout. Captured by callers via
//   DPF_HOST_PROFILE=$(pnpm exec tsx scripts/detect-hardware-host.ts)
//   docker compose up -d
//
// Per the deployment doctrine's Deployment Support Matrix (Apple
// Silicon row), macOS Apple Silicon hosts get
// `architecture: "unified"` because GPU memory is unified with RAM —
// the discrete-VRAM model-selection tiers don't apply directly. The
// `selectedModel` field reconciles unified vs discrete by treating
// total RAM as the effective ceiling on Apple Silicon.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

type Architecture = "unified" | "discrete" | "cpu-only";

type HostProfile = {
  platform: NodeJS.Platform;
  arch: string;
  architecture: Architecture;
  cpu: { name: string; cores: number };
  ram: { totalGB: number };
  gpu: { name: string; vramGB: number | null } | null;
  selectedModel: string;
  detectedAt: string;
  notes?: string[];
};

function run(cmd: string, args: string[]): string | null {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function detectDarwin(): HostProfile {
  const cpuName = run("sysctl", ["-n", "machdep.cpu.brand_string"]) ?? "Unknown CPU";
  const coresStr = run("sysctl", ["-n", "hw.ncpu"]) ?? "0";
  const cores = parseInt(coresStr, 10) || 0;
  const memBytesStr = run("sysctl", ["-n", "hw.memsize"]) ?? "0";
  const memBytes = parseInt(memBytesStr, 10) || 0;
  const totalGB = Math.round((memBytes / (1024 ** 3)) * 10) / 10;

  // Apple Silicon (M1/M2/M3/M4 series) reports an Apple GPU. Detect
  // via the cpu.brand_string substring rather than parsing
  // system_profiler JSON (avoids a second slow shell-out and works
  // identically on every Apple Silicon Mac).
  const isAppleSilicon = /Apple M\d/i.test(cpuName);

  let gpu: HostProfile["gpu"] = null;
  let architecture: Architecture;

  if (isAppleSilicon) {
    architecture = "unified";
    // Unified memory: GPU effectively shares RAM. Report the GPU name
    // for diagnostic value but `vramGB: null` because the concept
    // doesn't apply.
    // CodeQL #75 (js/identity-replacement): the previous replace mapped
    // "Apple " → "Apple " (no-op). The intent was to keep the "Apple"
    // prefix while annotating it as a GPU. Direct interpolation is
    // simpler and correct.
    gpu = { name: `${cpuName} GPU (unified)`, vramGB: null };
  } else {
    // Intel Mac (out of scope per the installer-parity roadmap, but
    // the script still produces a sensible profile in case someone
    // runs it for diagnostics). Fallback: cpu-only.
    architecture = "cpu-only";
  }

  return {
    platform: "darwin",
    arch: os.arch(),
    architecture,
    cpu: { name: cpuName, cores },
    ram: { totalGB },
    gpu,
    selectedModel: selectModel({ architecture, totalGB, gpu }),
    detectedAt: new Date().toISOString(),
  };
}

function detectLinux(): HostProfile {
  // CPU model name from /proc/cpuinfo
  let cpuName = "Unknown CPU";
  try {
    const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf8");
    const m = cpuinfo.match(/^model name\s*:\s*(.+)$/m);
    if (m && m[1]) cpuName = m[1].trim();
  } catch { /* keep default */ }

  const coresStr = run("nproc", []) ?? "0";
  const cores = parseInt(coresStr, 10) || 0;

  // RAM from /proc/meminfo
  let totalGB = 0;
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    const m = meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m);
    if (m && m[1]) {
      const kb = parseInt(m[1], 10);
      totalGB = Math.round((kb / (1024 * 1024)) * 10) / 10;
    }
  } catch { /* keep zero */ }

  // GPU: try nvidia-smi for NVIDIA discrete VRAM detection.
  // AMD / Intel discrete GPUs are not detected for VRAM here; the
  // model selection falls back to the no-GPU tier in that case.
  let gpu: HostProfile["gpu"] = null;
  let architecture: Architecture = "cpu-only";

  const nv = run("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (nv) {
    const firstLine = nv.split("\n")[0];
    if (firstLine && firstLine.trim()) {
      const parts = firstLine.split(",").map((s) => s.trim());
      const name = parts[0] ?? "NVIDIA GPU";
      const vramMB = parseInt(parts[1] ?? "0", 10);
      if (vramMB > 0) {
        const vramGB = Math.round((vramMB / 1024) * 10) / 10;
        gpu = { name, vramGB };
        architecture = "discrete";
      }
    }
  }

  // If no NVIDIA, do a best-effort detection via lspci so we at least
  // record a GPU model name even if VRAM isn't probed.
  if (!gpu) {
    const lspci = run("sh", ["-c", "lspci 2>/dev/null | grep -iE 'vga|3d|display' | head -1"]);
    if (lspci) {
      // lspci output: "01:00.0 VGA compatible controller: NVIDIA ..."
      const m = lspci.match(/:\s*[^:]+:\s*(.+)$/);
      const name = m && m[1] ? m[1].trim() : lspci.trim();
      gpu = { name, vramGB: null };
      // Without a VRAM read we can't choose discrete-VRAM tiers;
      // architecture stays cpu-only for selection purposes.
    }
  }

  return {
    platform: "linux",
    arch: os.arch(),
    architecture,
    cpu: { name: cpuName, cores },
    ram: { totalGB },
    gpu,
    selectedModel: selectModel({ architecture, totalGB, gpu }),
    detectedAt: new Date().toISOString(),
  };
}

// Model selection mirrors install-dpf.ps1's tiers (verified against the
// canonical MODEL_TIERS in apps/web/lib/inference/bootstrap-first-run.ts).
// Qwen3 — NOT Gemma — because the platform's Coworkers catalog tiers Qwen3
// as `strong + Tool Use` (F1 0.93 @ 8B, 0.97 @ 14B) while Gemma 3/4 tiers
// as `adequate`. Default coworkers have `minimumTier: strong`, so a Gemma
// pick fails routing on first install.
//
//   discrete VRAM >= 22GB:  ai/qwen3:30B-A3B-Q4_K_M  (30B MoE)
//   discrete VRAM >= 12GB:  ai/qwen3:14B-Q6_K        (14B dense)
//   discrete VRAM >=  6GB:  ai/qwen3:8B-Q4_K_M       (8B dense)
//   unified RAM   >= 32GB:  ai/qwen3:30B-A3B-Q4_K_M  (Apple Silicon hi-mem)
//   unified RAM   >= 24GB:  ai/qwen3:14B-Q6_K        (Apple Silicon mid)
//   unified RAM   >= 16GB:  ai/qwen3:8B-Q4_K_M       (Apple Silicon low-mem)
//   cpu-only / fallback:    ai/qwen3:4B-UD-Q4_K_XL   (4B dense, CPU-OK)
//
// Tags verified against https://hub.docker.com/r/ai/qwen3/tags 2026-05-23.
// Tags are case-sensitive: `ai/qwen3:14b` returns 404; `ai/qwen3:14B-Q6_K`
// resolves. Do not drop the quantization suffix.
function selectModel(p: {
  architecture: Architecture;
  totalGB: number;
  gpu: HostProfile["gpu"];
}): string {
  if (p.architecture === "discrete" && p.gpu && typeof p.gpu.vramGB === "number") {
    if (p.gpu.vramGB >= 22) return "ai/qwen3:30B-A3B-Q4_K_M";
    if (p.gpu.vramGB >= 12) return "ai/qwen3:14B-Q6_K";
    if (p.gpu.vramGB >= 6) return "ai/qwen3:8B-Q4_K_M";
  }
  if (p.architecture === "unified") {
    if (p.totalGB >= 32) return "ai/qwen3:30B-A3B-Q4_K_M";
    if (p.totalGB >= 24) return "ai/qwen3:14B-Q6_K";
    if (p.totalGB >= 16) return "ai/qwen3:8B-Q4_K_M";
  }
  return "ai/qwen3:4B-UD-Q4_K_XL";
}

function main(): void {
  const platform = os.platform();
  let profile: HostProfile;

  switch (platform) {
    case "darwin":
      profile = detectDarwin();
      break;
    case "linux":
      profile = detectLinux();
      break;
    default:
      // Windows hosts use install-dpf.ps1's PowerShell hardware
      // detection; this script is the macOS / Linux counterpart.
      console.error(
        `Unsupported platform: ${platform}. Windows hosts use install-dpf.ps1's WMI-based detection.`
      );
      process.exit(2);
  }

  // Emit a single JSON object — install-dpf.sh / setup.sh capture
  // this verbatim into DPF_HOST_PROFILE.
  process.stdout.write(JSON.stringify(profile));
}

main();
