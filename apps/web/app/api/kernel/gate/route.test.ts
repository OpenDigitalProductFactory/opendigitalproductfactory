import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const incMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: { wikiPage: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));

vi.mock("@/lib/operate/metrics", () => ({
  kernelGateDecisionsTotal: { inc: (...args: unknown[]) => incMock(...args) },
}));

beforeEach(async () => {
  const { __resetCacheForTest } = await import("@/lib/kernel/load-enforceable-principles");
  __resetCacheForTest();
  findManyMock.mockReset();
  incMock.mockReset();
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
});

describe("POST /api/kernel/gate", () => {
  it("returns refuse for a matching autonomous attempt and increments the counter", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "p1",
        slug: "never-wipe-db-for-code-fixes",
        principleTier: "commandment",
        principleRuntimeEnforcement: {
          interactiveMode: "confirm",
          autonomousMode: "refuse",
          patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "wipes operator state" }],
        },
      },
    ]);

    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/kernel/gate", {
      method: "POST",
      body: JSON.stringify({
        attempt: { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
        sessionClass: "autonomous",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("refuse");
    expect(body.principleSlug).toBe("never-wipe-db-for-code-fixes");
    expect(body.rationale).toContain("wipes operator state");
    expect(incMock).toHaveBeenCalledWith({
      verdict: "refuse",
      principle_slug: "never-wipe-db-for-code-fixes",
      session_class: "autonomous",
    });
  });

  it("returns allow + counter labelled _none for non-matching commands", async () => {
    findManyMock.mockResolvedValue([]);
    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/kernel/gate", {
      method: "POST",
      body: JSON.stringify({
        attempt: { kind: "shell", command: "docker", args: ["ps"] },
        sessionClass: "autonomous",
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({ verdict: "allow" });
    expect(incMock).toHaveBeenCalledWith({
      verdict: "allow",
      principle_slug: "_none",
      session_class: "autonomous",
    });
  });

  it("returns 400 on malformed JSON body", async () => {
    findManyMock.mockResolvedValue([]);
    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/kernel/gate", { method: "POST", body: "{garbage" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("returns 400 on body that fails schema validation", async () => {
    findManyMock.mockResolvedValue([]);
    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/kernel/gate", {
      method: "POST",
      body: JSON.stringify({ attempt: { kind: "unknown" }, sessionClass: "autonomous" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("returns require_confirm in interactive mode with a typed phrase", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "p1",
        slug: "never-wipe-db-for-code-fixes",
        principleTier: "commandment",
        principleRuntimeEnforcement: {
          interactiveMode: "confirm",
          autonomousMode: "refuse",
          patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "wipes operator state" }],
        },
      },
    ]);

    const { POST } = await import("./route");
    const req = new Request("http://localhost:3000/api/kernel/gate", {
      method: "POST",
      body: JSON.stringify({
        attempt: { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
        sessionClass: "interactive",
      }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.verdict).toBe("require_confirm");
    expect(body.requiredPhrase).toMatch(/^I-MEAN-IT-never-wipe-db-for-code-fixes-[A-Z0-9]{4}$/);
  });
});
