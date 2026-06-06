import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerActionEnvelope: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "env-1", ...data })),
      findUnique: vi.fn(),
    },
  },
}));

import { driveBrowserTask, executeApprovedBrowserAction } from "./drive";
import type { BrowserDriver } from "./driver";
import type { MeansSelectionResult } from "./select-means";
import { prisma } from "@dpf/db";

const okSelection: MeansSelectionResult = {
  means: "plugin", confidence: "high", margin: 2, ledger: [{ optionId: "plugin" }],
  status: "recommended", reason: "novel site",
};
const selectOk = vi.fn(async () => okSelection);

function fakeDriver(over?: Partial<Record<"act" | "open", unknown>>): BrowserDriver {
  return {
    means: "plugin",
    open: (over?.open as BrowserDriver["open"]) ?? (async () => ({ sessionId: "s1", means: "plugin" })),
    read: async () => ({ status: "completed", data: { extracted: true } }),
    act: (over?.act as BrowserDriver["act"]) ?? (async () => ({ status: "completed", detail: "done" })),
    screenshot: async () => ({}),
    close: async () => ({ sessionId: "s1", status: "closed" }),
  };
}

const base = {
  task: "fill the draft",
  siteKey: "substack",
  targetDomains: ["substack.com"],
  agentId: "marketing",
  threadId: "t1",
  userId: "u1",
};

beforeEach(() => vi.clearAllMocks());

describe("driveBrowserTask", () => {
  it("returns needs-provisioning when no service-account credential exists", async () => {
    const res = await driveBrowserTask({
      ...base,
      deps: { selectMeans: selectOk, makeDriver: () => fakeDriver(), readCredential: async () => null },
    });
    expect(res.status).toBe("needs-provisioning");
  });

  it("runs a non-destructive act end-to-end and returns completed", async () => {
    const res = await driveBrowserTask({
      ...base,
      deps: {
        selectMeans: selectOk,
        makeDriver: () => fakeDriver(),
        readCredential: async () => ({ mode: "storageState", storageState: {} }),
      },
    });
    expect(res.status).toBe("completed");
    if (res.status === "completed") expect(res.means).toBe("plugin");
  });

  it("proposes an envelope and does NOT act for an outward destructive action", async () => {
    const act = vi.fn(async () => ({ status: "completed" as const }));
    const res = await driveBrowserTask({
      ...base,
      task: "publish the newsletter",
      outwardAction: "publish",
      renderedArtifact: { title: "June" },
      targetUrl: "https://substack.com/publish/post/1",
      deps: {
        selectMeans: selectOk,
        makeDriver: () => fakeDriver({ act }),
        readCredential: async () => ({ mode: "storageState", storageState: {} }),
      },
    });
    expect(res.status).toBe("awaiting-approval");
    if (res.status === "awaiting-approval") expect(res.envelopeId).toBe("env-1");
    expect(act).not.toHaveBeenCalled(); // the destructive act must NOT run pre-approval
    expect(prisma.coworkerActionEnvelope.create).toHaveBeenCalledTimes(1);
  });

  it("returns needs-human when the means selector is not confident", async () => {
    const res = await driveBrowserTask({
      ...base,
      deps: {
        selectMeans: async () => ({ ...okSelection, status: "needs-human", confidence: "low" }),
        makeDriver: () => fakeDriver(),
        readCredential: async () => ({ mode: "storageState", storageState: {} }),
      },
    });
    expect(res.status).toBe("needs-human");
  });
});

describe("executeApprovedBrowserAction", () => {
  const approvedInput = {
    envelopeId: "env-1", command: "click Publish", siteKey: "substack",
    targetDomains: ["substack.com"], agentId: "marketing", threadId: "t1", userId: "u1",
  };

  it("refuses when the envelope is not approved", async () => {
    vi.mocked(prisma.coworkerActionEnvelope.findUnique).mockResolvedValueOnce({ id: "env-1", status: "proposed" } as never);
    const act = vi.fn();
    const res = await executeApprovedBrowserAction({ ...approvedInput, deps: { makeDriver: () => fakeDriver({ act }) } });
    expect(res.status).toBe("blocked");
    expect(act).not.toHaveBeenCalled();
  });

  it("runs the destructive act once the envelope is approved (links envelopeId)", async () => {
    vi.mocked(prisma.coworkerActionEnvelope.findUnique).mockResolvedValueOnce({ id: "env-1", status: "approved" } as never);
    const act = vi.fn(async () => ({ status: "completed" as const, detail: "published" }));
    const res = await executeApprovedBrowserAction({ ...approvedInput, deps: { makeDriver: () => fakeDriver({ act }) } });
    expect(res.status).toBe("completed");
    expect(act).toHaveBeenCalledTimes(1);
    expect((act.mock.calls[0] as unknown[])[2]).toEqual({ envelopeId: "env-1" });
  });
});
