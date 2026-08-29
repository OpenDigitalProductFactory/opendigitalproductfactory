import { describe, expect, it, vi } from "vitest";

import {
  FEDERATION_ADVERTISEMENT_PATH,
  FEDERATION_PAIR_PATH,
  FEDERATION_PROTOCOL_VERSION,
} from "@dpf/validators";

import {
  parseAdvertisementBody,
  probeFederationPeer,
  type FederationProbeAdapter,
} from "../collectors/federation-probe";
import {
  DEFAULT_SCAN_ENDPOINTS,
  buildScanTargets,
  parseScanEndpoints,
  resolveFederationScanSettings,
  runFederationScanLoop,
  scanFederationCandidates,
} from "../federation-scan";
import type { EdgeNodeConfig } from "../config";
import type { EdgeNodeState } from "../state";

const advertisement = {
  protocol: FEDERATION_PROTOCOL_VERSION,
  install: "yM4sS9VcH0rW2nQ8",
  caps: "8f31c9a2",
  pair: FEDERATION_PAIR_PATH,
  organization: "North Wind",
};

function adapterServing(bodies: Record<string, unknown>): FederationProbeAdapter {
  return {
    fetchAdvertisement: async (url: string) => {
      const body = bodies[url];
      if (body === undefined) return { status: 404, body: "" };
      return { status: 200, body: JSON.stringify(body) };
    },
  };
}

describe("parseAdvertisementBody", () => {
  it("accepts a well-formed descriptor", () => {
    expect(parseAdvertisementBody(JSON.stringify(advertisement))).toMatchObject({
      install: advertisement.install,
    });
  });

  it("refuses malformed JSON, an oversized body, and a foreign descriptor", () => {
    expect(parseAdvertisementBody("{")).toBeNull();
    expect(parseAdvertisementBody("x".repeat(5000))).toBeNull();
    expect(parseAdvertisementBody(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(
      parseAdvertisementBody(JSON.stringify({ ...advertisement, protocol: "2" })),
    ).toBeNull();
  });
});

describe("probeFederationPeer", () => {
  it("binds the candidate to the origin it dialled", async () => {
    const origin = "http://192.168.1.43:3000";
    const adapter = adapterServing({ [`${origin}${FEDERATION_ADVERTISEMENT_PATH}`]: advertisement });
    const candidate = await probeFederationPeer(origin, adapter);
    expect(candidate).toMatchObject({
      discoveryId: advertisement.install,
      endpoint: origin,
      organizationRef: "North Wind",
      pairPath: FEDERATION_PAIR_PATH,
    });
  });

  it("says nothing about a host that is not a DPF install", async () => {
    const adapter = adapterServing({});
    expect(await probeFederationPeer("http://192.168.1.99:3000", adapter)).toBeNull();
  });

  it("says nothing when the probe throws", async () => {
    const adapter: FederationProbeAdapter = {
      fetchAdvertisement: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    expect(await probeFederationPeer("http://192.168.1.99:3000", adapter)).toBeNull();
  });
});

describe("parseScanEndpoints", () => {
  it("defaults to the TLS overlay and the plain compose port", () => {
    expect(parseScanEndpoints(undefined)).toEqual([...DEFAULT_SCAN_ENDPOINTS]);
    expect(parseScanEndpoints("   ")).toEqual([...DEFAULT_SCAN_ENDPOINTS]);
  });

  it("keeps the good entries when one is mistyped", () => {
    expect(parseScanEndpoints("https:8443,gopher:70,http:0,http:3000")).toEqual([
      { scheme: "https", port: 8443 },
      { scheme: "http", port: 3000 },
    ]);
  });

  it("falls back only when nothing in the list is usable", () => {
    expect(parseScanEndpoints("gopher:70")).toEqual([...DEFAULT_SCAN_ENDPOINTS]);
  });
});

describe("buildScanTargets", () => {
  it("crosses hosts with endpoints and reports nothing dropped", () => {
    const targets = buildScanTargets({
      hosts: ["192.168.1.43", "10.0.0.2"],
      endpoints: [{ scheme: "http", port: 3000 }],
      maxTargets: 10,
    });
    expect(targets.origins).toEqual(["http://192.168.1.43:3000", "http://10.0.0.2:3000"]);
    expect(targets.dropped).toBe(0);
  });

  it("never dials a host outside the local segment", () => {
    const targets = buildScanTargets({
      hosts: ["8.8.8.8", "peer.example.com", "192.168.1.43"],
      endpoints: [{ scheme: "http", port: 3000 }],
      maxTargets: 10,
    });
    expect(targets.origins).toEqual(["http://192.168.1.43:3000"]);
    expect(targets.dropped).toBe(2);
  });

  it("brackets a bare IPv6 host", () => {
    const targets = buildScanTargets({
      hosts: ["fd12::2"],
      endpoints: [{ scheme: "https", port: 443 }],
      maxTargets: 10,
    });
    expect(targets.origins).toEqual(["https://[fd12::2]:443"]);
  });

  it("reports what the ceiling removed rather than looking complete", () => {
    const targets = buildScanTargets({
      hosts: ["192.168.1.1", "192.168.1.2", "192.168.1.3"],
      endpoints: [{ scheme: "http", port: 3000 }],
      maxTargets: 2,
    });
    expect(targets.origins).toHaveLength(2);
    expect(targets.dropped).toBe(1);
  });
});

describe("scanFederationCandidates", () => {
  it("collects peers, drops itself, and returns a stable order", async () => {
    const probe = vi.fn(async (origin: string) => {
      if (origin === "http://192.168.1.10:3000") {
        return { ...advertisementCandidate("peerBpeerBpeerBpeerB", origin) };
      }
      if (origin === "http://192.168.1.9:3000") {
        return { ...advertisementCandidate("peerApeerApeerApeerA", origin) };
      }
      if (origin === "http://192.168.1.5:3000") {
        return { ...advertisementCandidate("selfselfselfself0000", origin) };
      }
      return null;
    });
    const candidates = await scanFederationCandidates({
      origins: [
        "http://192.168.1.10:3000",
        "http://192.168.1.9:3000",
        "http://192.168.1.5:3000",
        "http://192.168.1.6:3000",
      ],
      probe,
      selfDiscoveryId: "selfselfselfself0000",
      concurrency: 2,
    });
    expect(candidates.map((c) => c.endpoint)).toEqual([
      "http://192.168.1.10:3000",
      "http://192.168.1.9:3000",
    ]);
  });
});

function advertisementCandidate(discoveryId: string, endpoint: string) {
  return {
    discoveryId,
    endpoint,
    protocol: FEDERATION_PROTOCOL_VERSION as "1",
    capabilityDigest: advertisement.caps,
    pairPath: FEDERATION_PAIR_PATH as "/connect/pair",
  };
}

describe("resolveFederationScanSettings", () => {
  it("scans by default and honours an operator's opt-out", () => {
    expect(resolveFederationScanSettings({}).enabled).toBe(true);
    for (const off of ["0", "false", "no", "off", " OFF "]) {
      expect(resolveFederationScanSettings({ DPF_FEDERATION_SCAN: off }).enabled).toBe(false);
    }
    expect(resolveFederationScanSettings({ DPF_FEDERATION_SCAN: "1" }).enabled).toBe(true);
  });

  it("prefers explicit hosts over the ARP cache", () => {
    const settings = resolveFederationScanSettings({
      DPF_FEDERATION_SCAN_HOSTS: " 10.0.0.2 , 10.0.0.3 ",
    });
    expect(settings.hosts).toEqual(["10.0.0.2", "10.0.0.3"]);
    expect(resolveFederationScanSettings({}).hosts).toBeNull();
  });

  it("ignores a nonsense interval rather than scanning in a tight loop", () => {
    expect(resolveFederationScanSettings({ DPF_FEDERATION_SCAN_INTERVAL_SEC: "0" }).intervalSec)
      .toBe(90);
    expect(resolveFederationScanSettings({ DPF_FEDERATION_SCAN_INTERVAL_SEC: "-5" }).intervalSec)
      .toBe(90);
  });
});

const config = {
  authorityUrl: "http://portal:3000",
  edgeNodeName: "test",
  stateDir: "/tmp",
  platform: "linux",
  installMode: "container-host",
  version: "0.1.0",
} as EdgeNodeConfig;

function state(trustState: EdgeNodeState["trustState"]): EdgeNodeState {
  return {
    nodeId: "edge_test",
    nodeToken: "dpfnode_test",
    trustState,
    enrolledAt: "2026-08-28T12:00:00.000Z",
    heartbeatIntervalSec: 30,
    sweepIntervalSec: 300,
    acceptedCapabilities: [],
  } as unknown as EdgeNodeState;
}

describe("runFederationScanLoop", () => {
  const settings = {
    enabled: true,
    intervalSec: 90,
    endpoints: [{ scheme: "http" as const, port: 3000 }],
    hosts: ["192.168.1.43"],
    maxTargets: 10,
  };

  it("submits what it found, without the local install", async () => {
    const submitFederationCandidates = vi.fn(async () => ({ ok: true }));
    const probeAdapter = adapterServing({
      // The Authority this node is enrolled against — its own install.
      [`http://portal:3000${FEDERATION_ADVERTISEMENT_PATH}`]: {
        ...advertisement,
        install: "selfselfselfself0000",
      },
      [`http://192.168.1.43:3000${FEDERATION_ADVERTISEMENT_PATH}`]: advertisement,
    });

    await runFederationScanLoop({
      config,
      api: { submitFederationCandidates } as never,
      state: state("trusted"),
      settings,
      probeAdapter,
      sleep: async () => {},
      log: () => {},
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      maxIterations: 1,
    });

    expect(submitFederationCandidates).toHaveBeenCalledTimes(1);
    const [, body] = submitFederationCandidates.mock.calls[0] as unknown as [string, {
      observedAt: string;
      candidates: Array<{ endpoint: string; organizationRef?: string }>;
    }];
    expect(body.observedAt).toBe("2026-08-28T12:00:00.000Z");
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      endpoint: "http://192.168.1.43:3000",
      organizationRef: "North Wind",
    });
  });

  it("never reports the install it is enrolled against as a peer", async () => {
    const submitFederationCandidates = vi.fn(async () => ({ ok: true }));
    // The portal answers on both its compose name and its LAN address.
    const probeAdapter = adapterServing({
      [`http://portal:3000${FEDERATION_ADVERTISEMENT_PATH}`]: advertisement,
      [`http://192.168.1.43:3000${FEDERATION_ADVERTISEMENT_PATH}`]: advertisement,
    });

    await runFederationScanLoop({
      config,
      api: { submitFederationCandidates } as never,
      state: state("trusted"),
      settings,
      probeAdapter,
      sleep: async () => {},
      log: () => {},
      maxIterations: 1,
    });

    expect(submitFederationCandidates).not.toHaveBeenCalled();
  });

  it("stays quiet until the node is trusted", async () => {
    const submitFederationCandidates = vi.fn(async () => ({ ok: true }));
    await runFederationScanLoop({
      config,
      api: { submitFederationCandidates } as never,
      state: state("pending"),
      settings,
      probeAdapter: adapterServing({}),
      sleep: async () => {},
      log: () => {},
      maxIterations: 1,
    });
    expect(submitFederationCandidates).not.toHaveBeenCalled();
  });

  it("returns immediately when an operator disabled scanning", async () => {
    const submitFederationCandidates = vi.fn(async () => ({ ok: true }));
    await runFederationScanLoop({
      config,
      api: { submitFederationCandidates } as never,
      state: state("trusted"),
      settings: { ...settings, enabled: false },
      probeAdapter: adapterServing({}),
      sleep: async () => {},
      log: () => {},
      maxIterations: 5,
    });
    expect(submitFederationCandidates).not.toHaveBeenCalled();
  });

  it("survives an Authority that refuses the snapshot", async () => {
    const submitFederationCandidates = vi.fn(async () => {
      throw new Error("boom");
    });
    const probeAdapter = adapterServing({
      [`http://192.168.1.43:3000${FEDERATION_ADVERTISEMENT_PATH}`]: advertisement,
    });
    await expect(
      runFederationScanLoop({
        config,
        api: { submitFederationCandidates } as never,
        state: state("trusted"),
        settings,
        probeAdapter,
        sleep: async () => {},
        log: () => {},
        maxIterations: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
