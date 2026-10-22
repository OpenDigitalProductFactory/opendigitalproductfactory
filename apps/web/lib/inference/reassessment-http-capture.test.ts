import { describe, expect, it } from "vitest";
import { captureReassessmentHttpResponse } from "./reassessment-http-capture";

describe("lossless reassessment HTTP observation", () => {
  it("preserves BOM and invalid UTF-8 without consuming the adapter's body", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc0, 0x80, 0xff]);
    const response = new Response(bytes, { status: 200 });
    const capture = await captureReassessmentHttpResponse(response);
    expect(Buffer.from(capture.bodyBase64, "base64")).toEqual(Buffer.from(bytes));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(bytes));
  });
  it("retains retry and response semantics while excluding authentication", async () => {
    const capture = await captureReassessmentHttpResponse(new Response("retry", { status: 429,
      headers: { "Retry-After": "12", Location: "/next", "Content-Encoding": "identity",
        "X-Provider-Semantic": "retained", "Set-Cookie": "secret", Authorization: "secret" } }));
    expect(capture.headers).toMatchObject({ "retry-after": "12", location: "/next",
      "content-encoding": "identity", "x-provider-semantic": "retained" });
    expect(JSON.stringify(capture)).not.toContain("secret");
  });
});
