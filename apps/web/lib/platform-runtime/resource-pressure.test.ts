import { describe, expect, it } from "vitest";
import {
  computeCpuPct,
  loadResourcePressure,
  parseBinarySize,
  parseEngineRunning,
  parseMemInfoKb,
  parseModelList,
} from "./resource-pressure";

const MEMINFO = [
  "MemTotal:       24610000 kB",
  "MemFree:          518124 kB",
  "MemAvailable:   15992988 kB",
  "Buffers:         4354960 kB",
].join("\n");

/** A minimal /containers/{id}/stats payload. */
function stats({ usage, inactiveFile = 0 }: { usage: number; inactiveFile?: number }) {
  return {
    memory_stats: { usage, stats: { inactive_file: inactiveFile } },
    cpu_stats: {
      cpu_usage: { total_usage: 200 },
      system_cpu_usage: 2000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 100 },
      system_cpu_usage: 1000,
    },
  };
}

function makeDockerGet(
  containers: Array<{ Id: string; Names: string[]; Image: string }>,
  statsById: Record<string, unknown>,
  info: unknown = { NCPU: 12 },
) {
  return async (path: string): Promise<unknown> => {
    if (path === "/containers/json") return containers;
    if (path === "/info") return info;
    const m = /^\/containers\/([^/]+)\/stats/.exec(path);
    if (m) {
      const s = statsById[m[1]];
      if (s === undefined) throw new Error("no stats");
      return s;
    }
    throw new Error(`unexpected path ${path}`);
  };
}

describe("parseMemInfoKb", () => {
  it("extracts the kB value for a key", () => {
    expect(parseMemInfoKb(MEMINFO, "MemTotal")).toBe(24610000);
    expect(parseMemInfoKb(MEMINFO, "MemAvailable")).toBe(15992988);
  });
  it("returns null for a missing key", () => {
    expect(parseMemInfoKb(MEMINFO, "SwapTotal")).toBeNull();
  });
});

describe("parseBinarySize", () => {
  it("parses binary units", () => {
    expect(parseBinarySize("16.45GiB")).toBe(Math.round(16.45 * 1024 ** 3));
    expect(parseBinarySize("260.86MiB")).toBe(Math.round(260.86 * 1024 ** 2));
  });
  it("tolerates spacing and decimal GB", () => {
    expect(parseBinarySize("23.47 GB")).toBe(Math.round(23.47 * 1024 ** 3));
  });
  it("returns null for junk", () => {
    expect(parseBinarySize("not a size")).toBeNull();
  });
});

describe("computeCpuPct", () => {
  it("applies the docker stats formula", () => {
    // cpuDelta=100, sysDelta=1000, online=4 → 0.1 * 4 * 100 = 40
    expect(
      computeCpuPct(
        { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 4 },
        { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      ),
    ).toBe(40);
  });
  it("returns null when the system delta is non-positive (single-shot sample)", () => {
    expect(
      computeCpuPct(
        { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000, online_cpus: 4 },
        { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      ),
    ).toBeNull();
  });
});

describe("parseEngineRunning", () => {
  it("detects a running backend", () => {
    expect(
      parseEngineRunning({
        status: 200,
        body: JSON.stringify({ "llama.cpp": "Running: llama.cpp latest-cuda", vllm: "Not Installed" }),
      }),
    ).toBe(true);
  });
  it("reports false when no backend is running", () => {
    expect(
      parseEngineRunning({ status: 200, body: JSON.stringify({ "llama.cpp": "Not Installed" }) }),
    ).toBe(false);
  });
  it("returns null when unreachable", () => {
    expect(parseEngineRunning(null)).toBeNull();
  });
});

describe("parseModelList", () => {
  it("sizes and sorts models biggest-first", () => {
    const models = parseModelList({
      status: 200,
      body: JSON.stringify({
        data: [
          { id: "docker.io/ai/nomic-embed-text-v1.5:latest", dmr: { size: "260.86MiB" } },
          { id: "docker.io/ai/qwen3-coder:latest", dmr: { size: "16.45GiB" } },
        ],
      }),
    });
    expect(models.map((m) => m.label)).toEqual(["qwen3-coder", "nomic-embed-text-v1.5"]);
    expect(models[0].sizeBytes).toBe(Math.round(16.45 * 1024 ** 3));
  });
});

describe("loadResourcePressure", () => {
  const containers = [
    { Id: "aaa", Names: ["/dpf-sandbox-1"], Image: "dpf-sandbox" },
    { Id: "bbb", Names: ["/dpf-portal-1"], Image: "dpf-portal" },
  ];

  it("computes VM pressure, container attribution, and the model-runner gap", async () => {
    // VM: total 24610000kB, available 15992988kB → used ≈ 8617012kB ≈ 8.82e9 B
    // sandbox usage 3GiB (no cache) + portal usage 1GiB → attributed 4GiB
    const statsById = {
      aaa: stats({ usage: 3 * 1024 ** 3 }),
      bbb: stats({ usage: 1 * 1024 ** 3 }),
    };
    const snap = await loadResourcePressure({
      readProcFile: async () => MEMINFO,
      dockerGet: makeDockerGet(containers, statsById),
      modelRunnerGet: async () => null,
      now: () => 1_000_000,
    });

    expect(snap.memory.available).toBe(true);
    if (!snap.memory.available) throw new Error("expected available memory");
    expect(snap.memory.vmTotalBytes).toBe(24610000 * 1024);
    expect(snap.memory.vmUsedBytes).toBe((24610000 - 15992988) * 1024);
    expect(snap.memory.containerAttributedBytes).toBe(4 * 1024 ** 3);
    // otherBytes = vmUsed - attributed (the model runner + overhead bucket)
    expect(snap.memory.otherBytes).toBe(
      (24610000 - 15992988) * 1024 - 4 * 1024 ** 3,
    );
    // sorted biggest-first
    expect(snap.containers.map((c) => c.name)).toEqual(["dpf-sandbox-1", "dpf-portal-1"]);
    expect(snap.containers[0].memPctOfVm).not.toBeNull();
    expect(snap.cpuCount).toBe(12);
    expect(snap.capturedAt).toBe(new Date(1_000_000).toISOString());
  });

  it("subtracts page cache like docker stats does", async () => {
    const statsById = {
      aaa: stats({ usage: 3 * 1024 ** 3, inactiveFile: 1 * 1024 ** 3 }),
    };
    const snap = await loadResourcePressure({
      readProcFile: async () => MEMINFO,
      dockerGet: makeDockerGet([containers[0]], statsById),
      modelRunnerGet: async () => null,
    });
    expect(snap.containers[0].memBytes).toBe(2 * 1024 ** 3);
  });

  it("degrades gracefully when /proc/meminfo is unavailable", async () => {
    const snap = await loadResourcePressure({
      readProcFile: async () => {
        throw new Error("ENOENT");
      },
      dockerGet: makeDockerGet(containers, {
        aaa: stats({ usage: 1 * 1024 ** 3 }),
        bbb: stats({ usage: 1 * 1024 ** 3 }),
      }),
      modelRunnerGet: async () => null,
    });
    expect(snap.memory.available).toBe(false);
    if (snap.memory.available) throw new Error("expected unavailable");
    expect(snap.memory.reason).toBe("meminfo_unavailable");
    // container view still works; %-of-VM is null without a VM total
    expect(snap.containers).toHaveLength(2);
    expect(snap.containers[0].memPctOfVm).toBeNull();
  });

  it("degrades gracefully when the docker socket is unavailable", async () => {
    const snap = await loadResourcePressure({
      readProcFile: async () => MEMINFO,
      dockerGet: async () => {
        throw new Error("EACCES");
      },
      modelRunnerGet: async () => null,
    });
    expect(snap.containers).toEqual([]);
    expect(snap.memory.available).toBe(true);
    if (!snap.memory.available) throw new Error("expected available");
    // With no containers, the whole VM-used figure lands in the "other" bucket.
    expect(snap.memory.otherBytes).toBe(snap.memory.vmUsedBytes);
  });

  it("drops containers whose stats vanish mid-snapshot without failing", async () => {
    const snap = await loadResourcePressure({
      readProcFile: async () => MEMINFO,
      dockerGet: makeDockerGet(containers, { aaa: stats({ usage: 2 * 1024 ** 3 }) }),
      modelRunnerGet: async () => null,
    });
    expect(snap.containers.map((c) => c.name)).toEqual(["dpf-sandbox-1"]);
  });

  it("surfaces local-model state when the model runner answers", async () => {
    const snap = await loadResourcePressure({
      readProcFile: async () => MEMINFO,
      dockerGet: makeDockerGet(containers, {
        aaa: stats({ usage: 1 * 1024 ** 3 }),
        bbb: stats({ usage: 1 * 1024 ** 3 }),
      }),
      modelRunnerGet: async (path) => {
        if (path === "/engines/status") {
          return { status: 200, body: JSON.stringify({ "llama.cpp": "Running: cuda" }) };
        }
        return {
          status: 200,
          body: JSON.stringify({ data: [{ id: "docker.io/ai/qwen3-coder:latest", dmr: { size: "16.45GiB" } }] }),
        };
      },
    });
    expect(snap.localModel.reachable).toBe(true);
    expect(snap.localModel.engineRunning).toBe(true);
    expect(snap.localModel.models[0].label).toBe("qwen3-coder");
  });
});
