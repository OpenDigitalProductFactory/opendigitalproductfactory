// BI-7BCC87BB (plan B8, AC-OVERRIDE): the on-behalf reason is recorded on the
// request and in the audit row, so it is trimmed and bounded before either.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));

import { ON_BEHALF_REASON_MAX_LENGTH, readOnBehalfRequest } from "./envelope-on-behalf-request";

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent/envelope/env-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ADMIN = { platformRole: "HR-000", isSuperuser: true };

describe("readOnBehalfRequest", () => {
  it("trims the reason", async () => {
    expect(await readOnBehalfRequest(post({ onBehalf: true, reason: "  Owner left.  " }), ADMIN))
      .toEqual({ reason: "Owner left.", callerIsAdmin: true });
  });

  it("caps an over-long reason at the recorded limit", async () => {
    const request = await readOnBehalfRequest(post({ onBehalf: true, reason: `  ${"x".repeat(ON_BEHALF_REASON_MAX_LENGTH + 250)}  ` }), ADMIN);
    expect(ON_BEHALF_REASON_MAX_LENGTH).toBe(500);
    expect(request?.reason).toHaveLength(ON_BEHALF_REASON_MAX_LENGTH);
  });

  it("reads no override without the onBehalf flag, and an empty reason when none is a string", async () => {
    expect(await readOnBehalfRequest(post({ reason: "x" }), ADMIN)).toBeUndefined();
    expect(await readOnBehalfRequest(post({ onBehalf: true, reason: 42 }), ADMIN)).toEqual({ reason: "", callerIsAdmin: true });
  });
});
