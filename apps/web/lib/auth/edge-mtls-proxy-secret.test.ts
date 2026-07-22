import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadEdgeMtlsProxySecret } from "./edge-mtls-proxy-secret";

describe("loadEdgeMtlsProxySecret", () => {
  it("loads a host-mounted proxy assertion without exposing it in environment", () => {
    const directory = mkdtempSync(join(tmpdir(), "dpf-edge-proxy-secret-"));
    const path = join(directory, "proxy-secret");
    writeFileSync(path, `${"a".repeat(64)}\n`, { mode: 0o600 });
    expect(loadEdgeMtlsProxySecret({ DPF_EDGE_MTLS_PROXY_SECRET_FILE: path })).toBe("a".repeat(64));
  });

  it("fails closed for an absent or short assertion", () => {
    expect(() => loadEdgeMtlsProxySecret({})).toThrow(/not configured/i);
    const directory = mkdtempSync(join(tmpdir(), "dpf-edge-proxy-secret-"));
    const path = join(directory, "proxy-secret");
    writeFileSync(path, "short\n", { mode: 0o600 });
    expect(() => loadEdgeMtlsProxySecret({ DPF_EDGE_MTLS_PROXY_SECRET_FILE: path })).toThrow(/at least 32/i);
  });
});
