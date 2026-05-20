import { describe, expect, it, vi } from "vitest";

import {
  AuthorityHttpError,
  type AuthorityApiClient,
} from "../api-client";
import type { EdgeNodeConfig } from "../config";
import type { EdgeNodeState } from "../state";
import { runSweepLoop } from "../sweep";

function makeConfig(overrides: Partial<EdgeNodeConfig> = {}): EdgeNodeConfig {
  return {
    authorityUrl: "http://test-authority",
    edgeNodeName: "test-edge",
    platform: "linux",
    installMode: "container-host",
    version: "0.1.0-test",
    stateDir: "/tmp/test-edge",
    bootstrapToken: undefined,
    ...overrides,
  };
}

function makeState(overrides: Partial<EdgeNodeState> = {}): EdgeNodeState {
  return {
    nodeId: "edge_test",
    nodeToken: "dpfedge_TESTTOKEN",
    enrolledAt: "2026-05-12T00:00:00.000Z",
    heartbeatIntervalSec: 60,
    sweepIntervalSec: 300,
    acceptedCapabilities: ["discovery.network"],
    trustState: "trusted",
    ...overrides,
  };
}

function fakeAdapter() {
  return {
    hostname: () => "test-host",
    platform: () => "linux" as NodeJS.Platform,
    release: () => "6.5.0",
    arch: () => "x64",
    uptime: () => 100,
    totalmem: () => 1024,
    cpus: () => [{ model: "fake", speed: 1000 }],
    networkInterfaces: () => ({}),
  };
}

/**
 * Default ARP adapter for sweep tests — empty cache, no warnings.
 * Makes the host-info-only assertions deterministic regardless of
 * the CI runner's actual /proc/net/arp contents (the real default
 * adapter would inadvertently scrape the runner's ARP table).
 */
function emptyArpAdapter() {
  return {
    platform: () => "linux" as NodeJS.Platform,
    readProcNetArp: async () => "",
    execArpDashAn: () => "",
  };
}

/**
 * Default nmap adapter for sweep tests — empty allow-list, no exec.
 * The collector returns a "no scan-eligible subnets" warning and zero
 * items, keeping host-info-only assertions stable.
 */
function emptyNmapAdapter() {
  return {
    execNmap: () => "",
    allowlistAdapter: {
      networkInterfaces: () => ({}),
      env: {},
    },
  };
}

/**
 * Default SNMP adapter for sweep tests — no config file present, no
 * exec invocations. The collector returns empty (its no-op path) so
 * existing sweep assertions stay deterministic.
 */
function emptySnmpAdapter() {
  return {
    execSnmpget: () => "",
    configAdapter: {
      env: {},
      readFile: () => "",
      statMode: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    },
  };
}

/**
 * Default UniFi adapter for sweep tests — no adapters.json present.
 * The collector returns empty without ever calling fetch, so existing
 * sweep assertions stay deterministic regardless of the runner's
 * /etc/dpf-edge/adapters.json contents.
 */
function emptyUnifiAdapter() {
  return {
    fetch: async () => {
      throw new Error("emptyUnifiAdapter.fetch must not be called");
    },
    configAdapter: {
      env: {},
      readFile: () => "",
      statMode: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    },
  };
}

function makeApi(submit: AuthorityApiClient["submitDiscoveryRun"]): AuthorityApiClient {
  return {
    submitDiscoveryRun: submit,
    enroll: vi.fn(),
    heartbeat: vi.fn(),
  } as unknown as AuthorityApiClient;
}

describe("runSweepLoop", () => {
  it("submits one envelope per iteration on the happy path", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    let runKeyCounter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 3,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
      newRunKey: () => `run_${++runKeyCounter}`,
      now: () => new Date("2026-05-12T12:00:00.000Z"),
    });

    expect(submit).toHaveBeenCalledTimes(3);
    const firstCall = submit.mock.calls[0]!;
    const envelope = firstCall[1] as Record<string, unknown>;
    expect(envelope.runKey).toBe("run_1");
    expect(envelope.agentMode).toBe("container-host");
    expect(envelope.agentVersion).toBe("0.1.0-test");
    expect(envelope.observedAt).toBe("2026-05-12T12:00:00.000Z");
    expect(envelope.capabilities).toEqual(["discovery.network"]);
    expect((envelope.items as unknown[]).length).toBe(1);
    expect(envelope.relationships).toEqual([]);
  });

  it("stamps a unique runKey per sweep tick", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 5,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    const runKeys = submit.mock.calls.map((c) => (c[1] as Record<string, unknown>).runKey);
    expect(runKeys).toEqual(["run_1", "run_2", "run_3", "run_4", "run_5"]);
  });

  it("uses state.nodeToken as the bearer token on every submission", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState({ nodeToken: "dpfedge_specifictoken" }),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    expect(submit.mock.calls[0]![0]).toBe("dpfedge_specifictoken");
    expect(submit.mock.calls[1]![0]).toBe("dpfedge_specifictoken");
  });

  it("drops the envelope on 4xx client error (no retry)", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthorityHttpError(413, "payload_too_large", "too big"),
      )
      .mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    // 2 iterations × 1 submit each (no retry of dropped 413) = 2 total.
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("queues + retries on 5xx server error", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthorityHttpError(503, "service_unavailable", "down"),
      )
      .mockResolvedValueOnce({ ok: true }) // drain old envelope
      .mockResolvedValueOnce({ ok: true }); // submit new envelope
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    // 1st tick: submit run_1 → 503 → queue.
    // 2nd tick: drain queue (submit run_1 again, succeeds) + submit run_2.
    expect(submit).toHaveBeenCalledTimes(3);
    const runKeys = submit.mock.calls.map((c) => (c[1] as Record<string, unknown>).runKey);
    expect(runKeys).toEqual(["run_1", "run_1", "run_2"]);
  });

  it("queues + retries on network error", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("respects 429 the same as 5xx (queues for retry, not drop)", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new AuthorityHttpError(429, "rate_limited", "slow down"))
      .mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    expect(submit).toHaveBeenCalledTimes(3);
    const runKeys = submit.mock.calls.map((c) => (c[1] as Record<string, unknown>).runKey);
    expect(runKeys).toEqual(["run_1", "run_1", "run_2"]);
  });

  it("treats 401 node_revoked as drop (heartbeat loop owns lifecycle)", async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(
        new AuthorityHttpError(401, "node_revoked", "revoked"),
      );
    const api = makeApi(submit);

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 3,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    // 3 iterations, each tries once, drops, no retry. So 3 calls total.
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("drops oldest queued entry when buffer overflows", async () => {
    // Force 3 transient failures, buffer capped at 2 → oldest gets dropped.
    let resolveSubmit: () => void = () => {};
    const submit = vi.fn(async () => {
      // Always fail transiently so the buffer fills up.
      throw new AuthorityHttpError(503, "service_unavailable", "down");
    });
    void resolveSubmit;
    const api = makeApi(submit);

    const logs: Array<{ level: string; msg: string }> = [];
    const log = (level: "info" | "warn" | "error", msg: string) => {
      logs.push({ level, msg });
    };

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 5,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
      newRunKey: () => `run_${++counter}`,
      maxBufferedSubmissions: 2,
      log,
    });

    // Should have logged buffer-overflow drops.
    const drops = logs.filter((l) => l.msg.includes("buffer full"));
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(drops[0]!.msg).toContain("dropped oldest");
  });

  it("uses sweepIntervalSec from state to schedule each tick", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState({ sweepIntervalSec: 30 }),
      sleep,
      maxIterations: 3,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    // 3 iterations means 3 sleeps at the end of each tick.
    expect(sleepCalls).toEqual([30_000, 30_000, 30_000]);
  });

  it("continues sweeping even if a single submission collection throws", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    // Throw on the 2nd collect call to simulate a transient collect bug.
    let collectCallCount = 0;
    const throwingAdapter = () => {
      const base = fakeAdapter();
      return {
        ...base,
        hostname: () => {
          collectCallCount += 1;
          if (collectCallCount === 2) {
            throw new Error("collect glitch");
          }
          return "test-host";
        },
      };
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 3,
      hostInfoAdapter: throwingAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    // Iter 1 + 3 submit; iter 2 throws during collect. → 2 submits.
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("merges ARP-collector items into the same envelope as host-info", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    const populatedArpAdapter = {
      platform: () => "linux" as NodeJS.Platform,
      readProcNetArp: async () =>
        [
          "IP address       HW type     Flags     HW address            Mask     Device",
          "192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
          "192.168.1.42     0x1         0x2       11:22:33:44:55:66     *        eth0",
        ].join("\n"),
      execArpDashAn: () => "",
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 1,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: populatedArpAdapter,
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    const envelope = submit.mock.calls[0]![1] as Record<string, unknown>;
    const items = envelope.items as Array<{
      observedKey: string;
      itemType: string;
    }>;
    // 1 host-info item + 2 ARP neighbors = 3 total in the same sweep.
    expect(items).toHaveLength(3);
    const keys = items.map((i) => i.observedKey).sort();
    expect(keys).toEqual(
      expect.arrayContaining(["arp:192.168.1.1", "arp:192.168.1.42"]),
    );
    // Host-info's observedKey is the hashed host fingerprint; we don't
    // assert its exact value (test would be brittle against the
    // fingerprint algo), but the third entry is the host one.
    expect(items.some((i) => i.itemType === "host" && !i.observedKey.startsWith("arp:"))).toBe(
      true,
    );
  });

  it("surfaces ARP-collector warnings on the envelope", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    const failingArpAdapter = {
      platform: () => "linux" as NodeJS.Platform,
      readProcNetArp: async () => {
        throw new Error("EACCES: permission denied");
      },
      execArpDashAn: () => "",
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 1,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: failingArpAdapter,
      nmapAdapter: emptyNmapAdapter(),
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    const envelope = submit.mock.calls[0]![1] as Record<string, unknown>;
    expect(envelope.warnings).toBeDefined();
    expect((envelope.warnings as string[])[0]).toMatch(/arp.*EACCES/);
    // Host-info still produced its item even though ARP failed —
    // collector failures must not take down the whole sweep.
    expect((envelope.items as unknown[]).length).toBeGreaterThan(0);
  });

  it("merges nmap-sweep items + relationships into the envelope alongside host-info and ARP", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    // ARP collector finds one cached neighbor; nmap collector probes
    // the same /24 and finds two more (one of which overlaps the ARP
    // entry — Authority dedup handles that, the agent just submits).
    const populatedArpAdapter = {
      platform: () => "linux" as NodeJS.Platform,
      readProcNetArp: async () =>
        [
          "IP address       HW type     Flags     HW address            Mask     Device",
          "192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0",
        ].join("\n"),
      execArpDashAn: () => "",
    };

    const populatedNmapAdapter = {
      execNmap: () =>
        [
          "Host: 192.168.1.1 (gateway.local)\tStatus: Up",
          "Host: 192.168.1.42 ()\tStatus: Up",
        ].join("\n"),
      allowlistAdapter: {
        networkInterfaces: () => ({}),
        env: { DPF_EDGE_DISCOVERY_SUBNETS: "192.168.1.0/24" },
      },
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 1,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: populatedArpAdapter,
      nmapAdapter: populatedNmapAdapter,
      snmpAdapter: emptySnmpAdapter(),
      unifiAdapter: emptyUnifiAdapter(),
    });

    const envelope = submit.mock.calls[0]![1] as Record<string, unknown>;
    const items = envelope.items as Array<{
      observedKey: string;
      itemType: string;
    }>;

    // host-info(1) + arp(1) + nmap-subnet(1) + nmap-hosts(2) = 5
    expect(items).toHaveLength(5);

    // Subnet entity exists with the right key shape.
    expect(
      items.some((i) => i.observedKey === "subnet:192.168.1.0/24"),
    ).toBe(true);

    // MEMBER_OF relationships from each probed host to the subnet.
    const rels = envelope.relationships as Array<{
      fromObservedKey: string;
      toObservedKey: string;
      relationshipType: string;
    }>;
    expect(rels).toEqual([
      {
        fromObservedKey: "arp:192.168.1.1",
        toObservedKey: "subnet:192.168.1.0/24",
        relationshipType: "MEMBER_OF",
      },
      {
        fromObservedKey: "arp:192.168.1.42",
        toObservedKey: "subnet:192.168.1.0/24",
        relationshipType: "MEMBER_OF",
      },
    ]);
  });

  it("merges SNMP-poll items + SAME_AS relationships into the same envelope as host-info, ARP, and nmap", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    // C2's nmap discovers 192.168.1.1 (the LAN gateway), and the
    // operator has SNMP-configured the same IP. Both rows land in
    // one envelope and the SAME_AS relationship lets the Authority
    // collapse them into one canonical device.
    const populatedNmapAdapter = {
      execNmap: () => "Host: 192.168.1.1 (gw.lan)\tStatus: Up",
      allowlistAdapter: {
        networkInterfaces: () => ({}),
        env: { DPF_EDGE_DISCOVERY_SUBNETS: "192.168.1.0/24" },
      },
    };

    const populatedSnmpAdapter = {
      execSnmpget: (_t: unknown, oid: string) =>
        ({
          "1.3.6.1.2.1.1.5.0": '"gw.lan"',
          "1.3.6.1.2.1.1.1.0": '"Cisco IOS Software, ISR 1900"',
          "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.9.1.2069",
          "1.3.6.1.2.1.1.3.0": "(123) 0:00:01.23",
          "1.3.6.1.2.1.1.6.0": '""',
          "1.3.6.1.2.1.2.1.0": "8",
        })[oid] ?? "",
      configAdapter: {
        env: {},
        statMode: () => 0o600,
        readFile: () =>
          JSON.stringify({
            targets: [
              { host: "192.168.1.1", version: "2c", community: "public" },
            ],
          }),
      },
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 1,
      hostInfoAdapter: fakeAdapter(),
      arpAdapter: emptyArpAdapter(),
      nmapAdapter: populatedNmapAdapter,
      snmpAdapter: populatedSnmpAdapter,
    });

    const envelope = submit.mock.calls[0]![1] as Record<string, unknown>;
    const items = envelope.items as Array<{
      observedKey: string;
      itemType: string;
    }>;

    // host-info(1) + nmap-subnet(1) + nmap-host(1) + snmp-router(1) = 4
    expect(items).toHaveLength(4);

    // SNMP entity classified as router because sysDescr mentions Cisco IOS.
    const router = items.find((i) => i.observedKey === "snmp:192.168.1.1");
    expect(router?.itemType).toBe("router");

    // SAME_AS relationship links the snmp:<ip> + arp:<ip> entities.
    const rels = envelope.relationships as Array<{
      fromObservedKey: string;
      toObservedKey: string;
      relationshipType: string;
    }>;
    expect(rels).toContainEqual(
      expect.objectContaining({
        fromObservedKey: "snmp:192.168.1.1",
        toObservedKey: "arp:192.168.1.1",
        relationshipType: "SAME_AS",
      }),
    );
  });
});
