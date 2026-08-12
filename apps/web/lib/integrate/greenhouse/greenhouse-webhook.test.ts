import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  handleGreenhouseWebhook,
  parseGreenhouseHireEvent,
  verifyGreenhouseSignature,
} from "./greenhouse-webhook";
import type { HireLandingClient } from "./land-hire";

const SECRET = "wh-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

function fakeDb() {
  const findUnique = vi.fn().mockResolvedValue(null);
  const refCreate = vi.fn().mockResolvedValue({});
  const empCreate = vi.fn().mockResolvedValue({ id: "emp-1" });
  const tx = {
    masterDataSourceRef: { findUnique, create: refCreate },
    employeeProfile: { create: empCreate },
  };
  const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const db: HireLandingClient = {
    ...tx,
    $transaction: transaction as HireLandingClient["$transaction"],
  };
  return { db, empCreate };
}

const hireBody = JSON.stringify({
  action: "hire_candidate",
  payload: {
    application: {
      id: 900,
      candidate: {
        id: 500,
        first_name: "Ana",
        last_name: "López",
        email_addresses: [{ value: "ana@example.com" }],
      },
      offer: { starts_at: "2026-09-01" },
    },
  },
});

describe("verifyGreenhouseSignature", () => {
  it("accepts a correct HMAC-SHA256 signature (with or without sha256= prefix)", () => {
    const sig = sign(hireBody);
    expect(verifyGreenhouseSignature({ rawBody: hireBody, signatureHeader: sig, secret: SECRET })).toBe(true);
    expect(
      verifyGreenhouseSignature({ rawBody: hireBody, signatureHeader: `sha256=${sig}`, secret: SECRET }),
    ).toBe(true);
  });

  it("rejects a wrong signature, a missing header, and a missing secret", () => {
    expect(verifyGreenhouseSignature({ rawBody: hireBody, signatureHeader: "deadbeef", secret: SECRET })).toBe(false);
    expect(verifyGreenhouseSignature({ rawBody: hireBody, signatureHeader: null, secret: SECRET })).toBe(false);
    expect(verifyGreenhouseSignature({ rawBody: hireBody, signatureHeader: sign(hireBody), secret: "" })).toBe(false);
  });
});

describe("parseGreenhouseHireEvent", () => {
  it("normalizes a hire_candidate event into a GreenhouseHire", () => {
    const evt = parseGreenhouseHireEvent(JSON.parse(hireBody));
    expect(evt?.action).toBe("hire_candidate");
    expect(evt?.hire).toMatchObject({
      candidateId: "500",
      applicationId: "900",
      displayName: "Ana López",
      workEmail: "ana@example.com",
      startDate: "2026-09-01",
    });
  });

  it("returns hire=null for a non-hire action", () => {
    const evt = parseGreenhouseHireEvent({ action: "candidate_stage_change", payload: {} });
    expect(evt).toEqual({ action: "candidate_stage_change", hire: null });
  });
});

describe("handleGreenhouseWebhook", () => {
  it("401s an invalid signature and never touches the db", async () => {
    const { db, empCreate } = fakeDb();
    const res = await handleGreenhouseWebhook({
      rawBody: hireBody,
      signatureHeader: "bad",
      secret: SECRET,
      db,
    });
    expect(res.status).toBe(401);
    expect(empCreate).not.toHaveBeenCalled();
  });

  it("lands a hire on a valid hire_candidate event", async () => {
    const { db, empCreate } = fakeDb();
    const res = await handleGreenhouseWebhook({
      rawBody: hireBody,
      signatureHeader: sign(hireBody),
      secret: SECRET,
      db,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: "hire_candidate", landed: true });
    expect(empCreate).toHaveBeenCalledTimes(1);
  });

  it("acks a non-hire event without landing", async () => {
    const body = JSON.stringify({ action: "candidate_stage_change", payload: {} });
    const { db, empCreate } = fakeDb();
    const res = await handleGreenhouseWebhook({
      rawBody: body,
      signatureHeader: sign(body),
      secret: SECRET,
      db,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, ignored: true });
    expect(empCreate).not.toHaveBeenCalled();
  });
});
