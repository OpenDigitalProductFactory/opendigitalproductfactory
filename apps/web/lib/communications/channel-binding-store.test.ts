import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bindingFindMany: vi.fn(),
  bindingCount: vi.fn(),
  bindingUpsert: vi.fn(),
  bindingUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    communicationChannelBinding: {
      findMany: mocks.bindingFindMany,
      count: mocks.bindingCount,
      upsert: mocks.bindingUpsert,
      update: mocks.bindingUpdate,
    },
  },
}));

import {
  createCommunicationChannelBinding,
  listCommunicationChannelBindings,
  recordCommunicationChannelBindingTest,
} from "./channel-binding-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCommunicationChannelBindings", () => {
  it("maps stored channel bindings into dashboard rows and summary counts", async () => {
    mocks.bindingCount
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    mocks.bindingFindMany.mockResolvedValue([
      {
        bindingId: "bind-1",
        channelType: "teams",
        providerKey: "microsoft365",
        providerAccountId: "tenant-1",
        externalSubject: "user@contoso.com",
        displayLabel: null,
        verificationStatus: "verified",
        allowedUrgencies: ["priority", "urgent"],
        isActive: true,
        lastTestedAt: new Date("2026-05-15T10:00:00.000Z"),
        lastVerifiedAt: new Date("2026-05-15T10:00:00.000Z"),
        lastError: null,
        principal: { displayName: "Alex Chen" },
        employeeProfile: { displayName: "Alex C." },
      },
      {
        bindingId: "bind-2",
        channelType: "whatsapp",
        providerKey: "meta_whatsapp",
        providerAccountId: "",
        externalSubject: "+15551212",
        displayLabel: "Field WhatsApp",
        verificationStatus: "pending",
        allowedUrgencies: ["urgent"],
        isActive: true,
        lastTestedAt: null,
        lastVerifiedAt: null,
        lastError: "Template not approved",
        principal: { displayName: "Riley Stone" },
        employeeProfile: null,
      },
    ]);

    const dashboard = await listCommunicationChannelBindings({ take: 10 });

    expect(mocks.bindingFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    expect(dashboard.summary).toEqual({
      total: 3,
      active: 2,
      verified: 1,
      failed: 1,
      pending: 1,
    });
    expect(mocks.bindingCount).toHaveBeenCalledWith();
    expect(mocks.bindingCount).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(mocks.bindingCount).toHaveBeenCalledWith({ where: { verificationStatus: "verified" } });
    expect(mocks.bindingCount).toHaveBeenCalledWith({ where: { verificationStatus: "failed" } });
    expect(mocks.bindingCount).toHaveBeenCalledWith({ where: { verificationStatus: "pending" } });
    expect(dashboard.bindings[0]).toEqual({
      bindingId: "bind-1",
      channelType: "teams",
      providerKey: "microsoft365",
      providerAccountId: "tenant-1",
      externalSubject: "user@contoso.com",
      displayLabel: "Microsoft365 user@contoso.com",
      verificationStatus: "verified",
      allowedUrgencies: ["priority", "urgent"],
      isActive: true,
      lastTestedAt: "2026-05-15T10:00:00.000Z",
      lastVerifiedAt: "2026-05-15T10:00:00.000Z",
      lastError: null,
      principalDisplayName: "Alex Chen",
      employeeDisplayName: "Alex C.",
    });
  });
});

describe("createCommunicationChannelBinding", () => {
  it("rejects invalid channel input before writing", async () => {
    const result = await createCommunicationChannelBinding({
      principalId: "principal-1",
      channelType: "fax",
      providerKey: "fax",
      externalSubject: "555-1212",
      allowedUrgencies: ["urgent"],
    });

    expect(result).toEqual({ ok: false, message: "Unsupported channel: fax" });
    expect(mocks.bindingUpsert).not.toHaveBeenCalled();
  });

  it("upserts a normalized pending binding", async () => {
    mocks.bindingUpsert.mockResolvedValue({ bindingId: "bind-1" });

    const result = await createCommunicationChannelBinding({
      principalId: " principal-1 ",
      employeeProfileId: " emp-1 ",
      channelType: "Microsoft Teams",
      providerKey: " microsoft365 ",
      providerAccountId: " tenant-1 ",
      externalSubject: " user@contoso.com ",
      displayLabel: " Teams ",
      allowedUrgencies: ["priority", "urgent"],
    });

    expect(result).toEqual({
      ok: true,
      message: "Communication channel binding saved.",
      bindingId: "bind-1",
    });
    expect(mocks.bindingUpsert).toHaveBeenCalledWith({
      where: {
        channelType_providerKey_providerAccountId_externalSubject: {
          channelType: "teams",
          providerKey: "microsoft365",
          providerAccountId: "tenant-1",
          externalSubject: "user@contoso.com",
        },
      },
      create: expect.objectContaining({
        principalId: "principal-1",
        employeeProfileId: "emp-1",
        channelType: "teams",
        providerKey: "microsoft365",
        providerAccountId: "tenant-1",
        externalSubject: "user@contoso.com",
        displayLabel: "Teams",
        verificationStatus: "pending",
        allowedDirections: ["outbound"],
        allowedUrgencies: ["priority", "urgent"],
        isActive: true,
      }),
      update: expect.objectContaining({
        principalId: "principal-1",
        employeeProfileId: "emp-1",
        displayLabel: "Teams",
        allowedUrgencies: ["priority", "urgent"],
        isActive: true,
        lastError: null,
      }),
      select: { bindingId: true },
    });
  });

  it("normalizes provider-wide bindings to the default provider account key", async () => {
    mocks.bindingUpsert.mockResolvedValue({ bindingId: "bind-default-account" });

    const result = await createCommunicationChannelBinding({
      principalId: "principal-1",
      channelType: "in_app",
      providerKey: "dpf",
      externalSubject: "principal-1",
      allowedUrgencies: ["routine"],
    });

    expect(result).toEqual({
      ok: true,
      message: "Communication channel binding saved.",
      bindingId: "bind-default-account",
    });
    expect(mocks.bindingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channelType_providerKey_providerAccountId_externalSubject: {
            channelType: "in-app",
            providerKey: "dpf",
            providerAccountId: "",
            externalSubject: "principal-1",
          },
        },
        create: expect.objectContaining({
          providerAccountId: "",
        }),
      }),
    );
  });
});

describe("recordCommunicationChannelBindingTest", () => {
  it("marks a successful binding test as verified", async () => {
    mocks.bindingUpdate.mockResolvedValue({ bindingId: "bind-1" });

    const result = await recordCommunicationChannelBindingTest({
      bindingId: "bind-1",
      ok: true,
    });

    expect(result).toEqual({
      ok: true,
      message: "Communication channel binding test recorded.",
    });
    expect(mocks.bindingUpdate).toHaveBeenCalledWith({
      where: { bindingId: "bind-1" },
      data: expect.objectContaining({
        verificationStatus: "verified",
        lastError: null,
        lastTestedAt: expect.any(Date),
        lastVerifiedAt: expect.any(Date),
      }),
    });
  });

  it("records a failed binding test without marking verified", async () => {
    mocks.bindingUpdate.mockResolvedValue({ bindingId: "bind-1" });

    await recordCommunicationChannelBindingTest({
      bindingId: "bind-1",
      ok: false,
      errorMessage: "No provider credential.",
    });

    expect(mocks.bindingUpdate).toHaveBeenCalledWith({
      where: { bindingId: "bind-1" },
      data: expect.objectContaining({
        verificationStatus: "failed",
        lastError: "No provider credential.",
        lastTestedAt: expect.any(Date),
        lastVerifiedAt: null,
      }),
    });
  });
});
