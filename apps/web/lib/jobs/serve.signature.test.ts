// BI-3267763F: /api/inngest must refuse a function invocation signed with the
// key that compose used to ship as a default. The portal runs Inngest in
// production mode (INNGEST_DEV=0), so the SDK verifies X-Inngest-Signature;
// that is only a control while the key is secret.
import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const PUBLIC_DEFAULT_SIGNING_KEY = "abcdef0123456789"; // gitleaks:allow — the old public compose default this test refuses, not a credential (BI-3267763F)
const INSTALL_SIGNING_KEY = "9f".repeat(32);

// The SDK's scheme (inngest/helpers/net.js signDataWithKey): HMAC-SHA256 keyed
// by the signing key text, over the canonical JSON body followed by the
// timestamp. The body below is written with its keys already sorted, so its
// canonical JSON is exactly JSON.stringify.
function sign(body: string, key: string) {
  const ts = Math.round(Date.now() / 1000).toString();
  return `t=${ts}&s=${createHmac("sha256", key).update(body).update(ts).digest("hex")}`;
}

async function invoke(signingKeyUsedBySender: string) {
  vi.resetModules();
  vi.stubEnv("INNGEST_DEV", "0");
  vi.stubEnv("INNGEST_SIGNING_KEY", INSTALL_SIGNING_KEY);
  vi.stubEnv("INNGEST_EVENT_KEY", "8e".repeat(32));
  const { serveJobs } = await import("./serve");
  const { POST } = serveJobs([]);
  const body = JSON.stringify({ event: { data: {}, name: "ops/self-upgrade.run" } });
  const request = new Request("http://portal:3000/api/inngest?fnId=dpf-platform-forged&stepId=step", {
    method: "POST",
    headers: { "content-type": "application/json", "x-inngest-signature": sign(body, signingKeyUsedBySender) },
    body,
  });
  const response = await (POST as unknown as (req: Request, ctx: unknown) => Promise<Response>)(request, {});
  return { status: response.status, text: await response.text() };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/inngest signature verification", () => {
  it("rejects an invocation signed with the old public default key", async () => {
    const forged = await invoke(PUBLIC_DEFAULT_SIGNING_KEY);
    expect(forged.status).toBe(401);
  });

  it("gets past signature verification when signed with the install's own key", async () => {
    // Control: the same request with the right key is not refused for its
    // signature, so the rejection above is the key and not the request shape.
    const genuine = await invoke(INSTALL_SIGNING_KEY);
    expect(genuine.status).not.toBe(401);
  });
});
