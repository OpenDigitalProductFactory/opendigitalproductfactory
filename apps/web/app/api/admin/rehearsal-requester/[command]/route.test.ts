import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, findUnique, platformConfigFindUnique, loadEnvironmentClassResolution } = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  platformConfigFindUnique: vi.fn(),
  loadEnvironmentClassResolution: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@dpf/db", () => ({
  prisma: { s5RehearsalRequesterEnrollment: { findUnique }, platformConfig: { findUnique: platformConfigFindUnique } },
}));
vi.mock("@/lib/install/environment-class", () => ({ loadEnvironmentClassResolution }));

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import {
  deriveRequesterSetupDigest,
  encodeRequesterSetupContext,
  handleRequesterCommand,
  readBoundedRequestBody,
  type RequesterBoundaryPorts,
} from "@/lib/identity/s5-rehearsal-enrollment.server";
import { GET, POST } from "./route";

const ORIGIN = "https://dpf.test";
const enrollContext = {
  v: 1 as const, command: "enroll" as const, rulingRef: "ruling:1", reservationRef: "reservation:1",
  reservationRevision: "rev-1", attemptRef: "attempt:1", fixtureRef: "fixture:1",
};
const digest = deriveRequesterSetupDigest(enrollContext);
const retireContext = { v: 1 as const, command: "retire" as const, setupDigest: digest };

function request(command: string, init: { context?: string | null; origin?: string | null; fetchSite?: string | null;
  body?: string; contentType?: string } = {}) {
  const url = new URL(`${ORIGIN}/api/admin/rehearsal-requester/${command}`);
  const context = init.context === undefined
    ? encodeRequesterSetupContext(command === "retire" ? retireContext : enrollContext) : init.context;
  if (context !== null) url.searchParams.set("setupContext", context);
  const headers = new Headers({ "content-type": init.contentType ?? "application/x-www-form-urlencoded" });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.fetchSite) headers.set("sec-fetch-site", init.fetchSite);
  return new Request(url, { method: "POST", headers, body: init.body ?? "password=correct-horse" });
}

function ports(overrides: Partial<RequesterBoundaryPorts> = {}) {
  const base: RequesterBoundaryPorts = {
    environmentClass: vi.fn(async () => "development"),
    canonicalOrigin: vi.fn(() => ORIGIN),
    sessionUserId: vi.fn(async () => "owner-user"),
    currentReservation: vi.fn(async () => "matches" as const),
    retainedRecord: vi.fn(async () => null),
    readiness: vi.fn(async () => ({ ready: true as const })),
    requestTransaction: vi.fn(async (run) => {
      const { commit: _commit, ...result } = await run({ sql: { query: async () => [] }, client: null, stage: "pre-hash" });
      return result;
    }),
    preBodyOwnerAndDb: vi.fn(async () => ({ ok: true as const })),
    verifyRequesterState: vi.fn(async () => ({ verified: false as const })),
    readBody: vi.fn(async (req: Request) => req.text()),
    execute: vi.fn(async () => ({ status: 201, body: { outcome: "enrolled" } })),
  };
  return { ...base, ...overrides };
}

/** No body read, no hash and no write happened. */
function expectNoBodyOrEffects(p: RequesterBoundaryPorts) {
  expect(p.readBody).not.toHaveBeenCalled();
  expect(p.execute).not.toHaveBeenCalled();
}

describe("S5 rehearsal requester boundary (BI-9F7192F9 phase 4, AC-E1)", () => {
  it("derives the setup digest on the server from the verified refs only", () => {
    const expected = createHash("sha256")
      .update(canonicalJson({ schema: "s5-rehearsal-setup.v1", rulingRef: "ruling:1", reservationRef: "reservation:1" }))
      .digest("hex");
    expect(digest).toBe(expected);
  });

  it("refuses production before anything else", async () => {
    const p = ports({ environmentClass: vi.fn(async () => "production") });
    const result = await handleRequesterCommand(request("enroll"), "enroll", p);
    expect(result).toMatchObject({ status: 403, body: { code: "production_refused" } });
    expect(p.sessionUserId).not.toHaveBeenCalled();
    expectNoBodyOrEffects(p);
  });

  it.each([
    ["a foreign Origin, even with Sec-Fetch-Site same-origin", { origin: "https://evil.test", fetchSite: "same-origin" }],
    ["a present null Origin, even with Sec-Fetch-Site same-origin", { origin: "null", fetchSite: "same-origin" }],
    ["no Origin and no Sec-Fetch-Site", { origin: null }],
    ["no Origin and a cross-site fetch", { origin: null, fetchSite: "cross-site" }],
  ])("refuses %s with no body read", async (_label, init) => {
    const p = ports();
    const result = await handleRequesterCommand(request("enroll", init), "enroll", p);
    expect(result).toMatchObject({ status: 403, body: { code: "origin_refused" } });
    expect(p.sessionUserId).not.toHaveBeenCalled();
    expectNoBodyOrEffects(p);
  });

  it("accepts an absent Origin only with Sec-Fetch-Site same-origin, and refuses when no canonical origin resolves", async () => {
    const p = ports();
    await expect(handleRequesterCommand(request("enroll", { origin: null, fetchSite: "same-origin" }), "enroll", p))
      .resolves.toMatchObject({ status: 201 });
    const noCanonical = ports({ canonicalOrigin: vi.fn(() => null) });
    await expect(handleRequesterCommand(request("enroll"), "enroll", noCanonical))
      .resolves.toMatchObject({ status: 403, body: { code: "origin_refused" } });
  });

  it("requires a session, then a known command", async () => {
    const anonymous = ports({ sessionUserId: vi.fn(async () => null) });
    await expect(handleRequesterCommand(request("enroll"), "enroll", anonymous)).resolves.toMatchObject({ status: 401 });
    expectNoBodyOrEffects(anonymous);
    const unknown = ports();
    await expect(handleRequesterCommand(request("activate"), "activate", unknown)).resolves.toMatchObject({ status: 404 });
    expectNoBodyOrEffects(unknown);
  });

  it.each([
    ["missing", null],
    ["not base64url JSON", "%%%"],
    ["an extra field", encodeRequesterSetupContext({ ...enrollContext, setupDigest: digest } as never)],
    ["a command that differs from the path", encodeRequesterSetupContext(retireContext)],
    ["an empty ref", encodeRequesterSetupContext({ ...enrollContext, fixtureRef: "" })],
  ])("holds a %s setup context before any read", async (_label, context) => {
    const p = ports();
    const result = await handleRequesterCommand(request("enroll", { context }), "enroll", p);
    expect(result).toMatchObject({ status: 400, body: { code: "setup_context_invalid" } });
    expect(p.currentReservation).not.toHaveBeenCalled();
    expectNoBodyOrEffects(p);
  });

  it.each(["released", "replaced", "unavailable"] as const)("holds an enrollment whose reservation is %s, with no body read", async (state) => {
    const p = ports({ currentReservation: vi.fn(async () => state) });
    const result = await handleRequesterCommand(request("enroll"), "enroll", p);
    expect(result).toMatchObject({ status: 409, body: { code: `reservation_${state}` } });
    expect(p.readiness).not.toHaveBeenCalled();
    expectNoBodyOrEffects(p);
  });

  it("holds a retirement with no retained record, without consulting the reservation", async () => {
    const p = ports();
    const result = await handleRequesterCommand(request("retire", { body: "retirementReason=rehearsal_complete" }), "retire", p);
    expect(result).toMatchObject({ status: 409, body: { code: "requester_record_missing" } });
    expect(p.currentReservation).not.toHaveBeenCalled();
    expectNoBodyOrEffects(p);
  });

  it("holds on readiness and on the pre-body owner and DB check, in that order", async () => {
    const notReady = ports({ readiness: vi.fn(async () => ({ ready: false as const, code: "preview_enrollment_fence_unavailable" })) });
    await expect(handleRequesterCommand(request("enroll"), "enroll", notReady))
      .resolves.toMatchObject({ status: 409, body: { code: "preview_enrollment_fence_unavailable" } });
    expect(notReady.preBodyOwnerAndDb).not.toHaveBeenCalled();
    expectNoBodyOrEffects(notReady);
    const notOwner = ports({ preBodyOwnerAndDb: vi.fn(async () => ({ ok: false as const, error: "owner_binding_unavailable" })) });
    await expect(handleRequesterCommand(request("enroll"), "enroll", notOwner))
      .resolves.toMatchObject({ status: 409, body: { code: "owner_binding_unavailable" } });
    expectNoBodyOrEffects(notOwner);
  });

  it("answers an enrollment replay from the shared verification, without reading the body", async () => {
    const retired = ports({
      retainedRecord: vi.fn(async () => ({ lifecycle: "retired" as const })),
      verifyRequesterState: vi.fn(async () => ({ verified: true as const, lifecycle: "retired" as const, factsMatch: true })),
    });
    await expect(handleRequesterCommand(request("enroll"), "enroll", retired)).resolves.toMatchObject({ status: 200, body: { outcome: "retired" } });
    expect(retired.verifyRequesterState).toHaveBeenCalledWith(digest, expect.objectContaining({ rulingRef: "ruling:1" }));
    expectNoBodyOrEffects(retired);

    const replay = ports({
      retainedRecord: vi.fn(async () => ({ lifecycle: "active" as const })),
      verifyRequesterState: vi.fn(async () => ({ verified: true as const, lifecycle: "active" as const, factsMatch: true })),
    });
    await expect(handleRequesterCommand(request("enroll"), "enroll", replay)).resolves.toMatchObject({ status: 200, body: { outcome: "replay" } });
    expectNoBodyOrEffects(replay);
  });

  it.each([
    ["an alias-drifted retired record", { verified: false as const }],
    ["an active record whose facts differ", { verified: true as const, lifecycle: "active" as const, factsMatch: false }],
    ["a verified retired record whose attempt or fixture differs", { verified: true as const, lifecycle: "retired" as const, factsMatch: false }],
  ])("holds %s as requester_state_unverified, never retired", async (_label, verification) => {
    const p = ports({
      retainedRecord: vi.fn(async () => ({ lifecycle: "retired" as const })),
      verifyRequesterState: vi.fn(async () => verification),
    });
    await expect(handleRequesterCommand(request("enroll"), "enroll", p))
      .resolves.toMatchObject({ status: 409, body: { code: "requester_state_unverified" } });
    expectNoBodyOrEffects(p);
  });

  it.each([
    ["a non-form content type", { contentType: "application/json", body: '{"password":"x"}' }],
    ["a body over 4 KiB", { body: `password=${"a".repeat(4097)}` }],
    ["an extra field", { body: "password=correct-horse&role=admin" }],
    ["a repeated field", { body: "password=a&password=b" }],
    ["an empty password", { body: "password=" }],
    ["a password over 72 UTF-8 bytes", { body: `password=${encodeURIComponent("é".repeat(37))}` }],
  ])("reads but rejects %s with zero hasher calls and zero writes", async (_label, init) => {
    const p = ports();
    const result = await handleRequesterCommand(request("enroll", init), "enroll", p);
    expect(result).toMatchObject({ status: 400, body: { code: "body_invalid" } });
    expect(p.execute).not.toHaveBeenCalled();
  });

  it("rejects a retirement reason outside the closed set", async () => {
    const p = ports({ retainedRecord: vi.fn(async () => ({ lifecycle: "active" as const })) });
    const result = await handleRequesterCommand(request("retire", { body: "retirementReason=because" }), "retire", p);
    expect(result).toMatchObject({ status: 400, body: { code: "body_invalid" } });
    expect(p.execute).not.toHaveBeenCalled();
  });

  it("hands a valid body to the command only after every pre-body check passed", async () => {
    const p = ports();
    await expect(handleRequesterCommand(request("enroll"), "enroll", p)).resolves.toMatchObject({ status: 201 });
    expect(p.execute).toHaveBeenCalledTimes(1);
    expect(p.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: "enroll", userId: "owner-user", setupDigest: digest, password: "correct-horse",
    }), expect.objectContaining({ stage: "pre-hash" }));
  });
});

describe("served route is inert until its proofs are served", () => {
  beforeEach(() => {
    auth.mockReset(); findUnique.mockReset(); platformConfigFindUnique.mockReset(); loadEnvironmentClassResolution.mockReset();
    process.env.PUBLIC_URL = ORIGIN;
  });

  it("refuses on a production install", async () => {
    loadEnvironmentClassResolution.mockResolvedValue({ environmentClass: "production" });
    const response = await POST(request("enroll"), { params: Promise.resolve({ command: "enroll" }) });
    expect(response.status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });

  it("holds an enrollment on the unserved one-shot reservation owner (BI-588688A7), with no body read", async () => {
    loadEnvironmentClassResolution.mockResolvedValue({ environmentClass: "development" });
    auth.mockResolvedValue({ user: { id: "owner-user" } });
    const response = await POST(request("enroll"), { params: Promise.resolve({ command: "enroll" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "reservation_unavailable" });
  });

  it("holds a retirement on the denying preview fence once a record exists", async () => {
    loadEnvironmentClassResolution.mockResolvedValue({ environmentClass: "development" });
    auth.mockResolvedValue({ user: { id: "owner-user" } });
    findUnique.mockResolvedValue({ lifecycle: "active" });
    const response = await POST(request("retire", { body: "retirementReason=rehearsal_complete" }), { params: Promise.resolve({ command: "retire" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "preview_enrollment_fence_unavailable" });
  });

  it("serves the read-only status GET inert: production refuses, and owner binding holds before any connection", async () => {
    const status = (digestParam = digest) => new Request(`${ORIGIN}/api/admin/rehearsal-requester/status?setupDigest=${digestParam}`,
      { headers: { "sec-fetch-site": "same-origin" } });
    loadEnvironmentClassResolution.mockResolvedValue({ environmentClass: "production" });
    expect((await GET(status(), { params: Promise.resolve({ command: "status" }) })).status).toBe(403);
    loadEnvironmentClassResolution.mockResolvedValue({ environmentClass: "development" });
    auth.mockResolvedValue({ user: { id: "owner-user" } });
    const held = await GET(status(), { params: Promise.resolve({ command: "status" }) });
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({ code: "owner_binding_unavailable" });
    expect((await GET(status("not-a-digest"), { params: Promise.resolve({ command: "status" }) })).status).toBe(400);
    expect((await GET(status(), { params: Promise.resolve({ command: "enroll" }) })).status).toBe(404);
  });
});

describe("bounded body reader (the served reader, not a substitute)", () => {
  function streamed(chunks: Uint8Array[], url = `${ORIGIN}/api/admin/rehearsal-requester/enroll`) {
    let cancelled = false;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[pulled++];
        if (next) controller.enqueue(next); else controller.close();
      },
      cancel() { cancelled = true; },
    });
    const req = new Request(url, {
      method: "POST", body, headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, duplex: "half",
    } as RequestInit);
    return { req, wasCancelled: () => cancelled, pulls: () => pulled };
  }

  it("retains at most 4 KiB + 1 of one oversized chunk and cancels the stream", async () => {
    const { req, wasCancelled, pulls } = streamed([new Uint8Array(1024 * 1024).fill(0x61), new Uint8Array(10)]);
    const text = await readBoundedRequestBody(req);
    expect(Buffer.byteLength(text, "utf8")).toBe(4097);
    expect(wasCancelled()).toBe(true);
    expect(pulls()).toBeLessThanOrEqual(2);
  });

  it("returns a body at the limit whole, across chunks", async () => {
    const head = new TextEncoder().encode(`password=${"a".repeat(2039)}`);
    const { req } = streamed([head, new Uint8Array(4096 - head.byteLength).fill(0x62)]);
    expect(Buffer.byteLength(await readBoundedRequestBody(req), "utf8")).toBe(4096);
  });

  it("rejects an oversized body through the served reader with zero hasher or mutator calls", async () => {
    const url = new URL(`${ORIGIN}/api/admin/rehearsal-requester/enroll`);
    url.searchParams.set("setupContext", encodeRequesterSetupContext(enrollContext));
    const p = ports({ readBody: vi.fn(readBoundedRequestBody) });
    const { req } = streamed([new Uint8Array(64 * 1024).fill(0x61)], url.toString());
    await expect(handleRequesterCommand(req, "enroll", p)).resolves.toMatchObject({ status: 400, body: { code: "body_invalid" } });
    expect(p.readBody).toHaveBeenCalledTimes(1);
    expect(p.execute).not.toHaveBeenCalled();
  });
});
