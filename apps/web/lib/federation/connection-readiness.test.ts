import { describe, expect, it } from "vitest";

import {
  computeConnectionReadiness,
  type ConnectionReadinessItem,
} from "./connection-readiness";

function item(
  r: ReturnType<typeof computeConnectionReadiness>,
  key: ConnectionReadinessItem["key"],
): ConnectionReadinessItem {
  const found = r.items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

describe("computeConnectionReadiness", () => {
  it("all three set for a LAN install → ready, no fixes", () => {
    const r = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      PUBLIC_URL: "http://192.168.0.152:3000",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "1",
    });
    expect(r.overall).toBe("ready");
    expect(r.items.every((i) => i.status === "ok")).toBe(true);
    expect(r.items.every((i) => i.fix === undefined)).toBe(true);
  });

  it("exchange off → action-required with the exact env line", () => {
    const r = computeConnectionReadiness({
      PUBLIC_URL: "http://192.168.0.152:3000",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "1",
    });
    expect(r.overall).toBe("action-required");
    expect(item(r, "exchange").status).toBe("action-required");
    expect(item(r, "exchange").fix).toBe("DPF_FEDERATION_EXCHANGE_ENABLED=1");
  });

  it("self address unset → action-required with PUBLIC_URL fix", () => {
    const r = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "1",
    });
    expect(item(r, "self-address").status).toBe("action-required");
    expect(item(r, "self-address").fix).toContain("PUBLIC_URL=");
  });

  it("the exact real-world Mac state (exchange only) flags the two missing vars", () => {
    // Mirrors the observed live Mac: EXCHANGE=1, PUBLIC_URL empty, ALLOW_INSECURE=0.
    const r = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      PUBLIC_URL: "",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "0",
    });
    expect(r.overall).toBe("action-required");
    expect(item(r, "exchange").status).toBe("ok");
    expect(item(r, "self-address").status).toBe("action-required");
    expect(item(r, "lan-peers").status).toBe("action-required");
    expect(item(r, "lan-peers").fix).toBe("DPF_FEDERATION_ALLOW_INSECURE_PEERS=1");
  });

  it("https public self URL → lan-peers is not-applicable even with the flag off", () => {
    const r = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      PUBLIC_URL: "https://portal.example.com",
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "0",
    });
    expect(item(r, "lan-peers").status).toBe("not-applicable");
    expect(r.overall).toBe("ready");
  });

  it.each([
    "http://192.168.0.152:3000",
    "http://10.1.2.3:3000",
    "http://172.16.0.9:3000",
    "http://localhost:3000",
    "https://myhost.local:3000",
  ])("insecure/LAN self URL %s requires allow-insecure", (url) => {
    const r = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      PUBLIC_URL: url,
      DPF_FEDERATION_ALLOW_INSECURE_PEERS: "0",
    });
    expect(item(r, "lan-peers").status).toBe("action-required");
  });

  it.each(["172.15.0.1", "172.32.0.1"])(
    "https host just outside the private 172.16-31 range (%s) is not treated as LAN",
    (host) => {
      const r = computeConnectionReadiness({
        DPF_FEDERATION_EXCHANGE_ENABLED: "1",
        PUBLIC_URL: `https://${host}:3000`,
        DPF_FEDERATION_ALLOW_INSECURE_PEERS: "0",
      });
      expect(item(r, "lan-peers").status).toBe("not-applicable");
    },
  );

  it("NEXT_PUBLIC_APP_URL satisfies the self-address check (precedence)", () => {
    const r = computeConnectionReadiness({
      DPF_FEDERATION_EXCHANGE_ENABLED: "1",
      NEXT_PUBLIC_APP_URL: "https://portal.example.com",
    });
    expect(item(r, "self-address").status).toBe("ok");
  });
});
