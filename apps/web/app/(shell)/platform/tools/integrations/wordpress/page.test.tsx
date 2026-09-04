import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  readSetupState: vi.fn(),
  projectionCount: vi.fn(),
  projectionFindMany: vi.fn(),
  publicationFindMany: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn((target: string) => { throw new Error(`redirect:${target}`); }) }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/integrations/kernel/credential-store", () => ({
  createPrismaConnectorCredentialRepository: vi.fn(() => ({})),
  createConnectorCredentialStore: vi.fn(() => ({ readSetupState: mocks.readSetupState })),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    externalChannelProjection: { count: mocks.projectionCount, findMany: mocks.projectionFindMany },
    outboundPublication: { findMany: mocks.publicationFindMany },
  },
}));
vi.mock("@/components/integrations/WordPressConnectPanel", () => ({
  WordPressConnectPanel: ({ initialState }: { initialState: { status: string; siteName: string | null } }) => (
    <div data-testid="wordpress-connect-panel" data-status={initialState.status}>{initialState.siteName}</div>
  ),
}));

describe("WordPressIntegrationPage", () => {
  it("uses a neutral projection state before the first publication", async () => {
    mocks.auth.mockResolvedValue({ user: { platformRole: "superadmin", isSuperuser: true } });
    mocks.can.mockReturnValue(true);
    mocks.readSetupState.mockResolvedValue({
      integrationId: "wordpress-self-hosted",
      provider: "wordpress",
      status: "not-connected",
      safeProjection: {},
      lastErrorMsg: null,
      lastTestedAt: null,
    });
    mocks.projectionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mocks.projectionFindMany.mockResolvedValue([]);
    mocks.publicationFindMany.mockResolvedValue([]);

    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page());

    expect(html).toContain("No projections yet");
    expect(html).not.toContain("No drift detected");
    expect(html).toContain(">Ownership boundary</summary>");
  });

  it("renders the canonical ownership boundary, attention state, and safe activity receipts", async () => {
    mocks.auth.mockResolvedValue({ user: { platformRole: "superadmin", isSuperuser: true } });
    mocks.can.mockReturnValue(true);
    mocks.readSetupState.mockResolvedValue({
      integrationId: "wordpress-self-hosted",
      provider: "wordpress",
      status: "connected",
      safeProjection: { siteName: "Second Chance Rescue", siteUrl: "https://rescue.example" },
      lastErrorMsg: null,
      lastTestedAt: new Date("2026-08-22T07:00:00.000Z"),
    });
    mocks.projectionCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    mocks.projectionFindMany.mockResolvedValue([{
      externalChannelProjectionId: "ecp-1",
      resourceKind: "post",
      sourceRef: "draft-1",
      state: "drifted",
      externalUrl: "https://rescue.example/?p=42",
      updatedAt: new Date("2026-08-22T07:10:00.000Z"),
    }]);
    mocks.publicationFindMany.mockResolvedValue([{
      publicationId: "pub-1",
      externalUrl: "https://rescue.example/?p=42",
      publishedAt: new Date("2026-08-22T07:05:00.000Z"),
      draft: { body: "Adoption day this Saturday" },
    }]);

    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page());

    expect(html).toContain("WordPress (self-hosted)");
    expect(html).toContain("does not host the site");
    expect(html).toContain('data-status="connected"');
    expect(html).toContain("External content needs review");
    expect(html).toContain("DPF owns");
    expect(html).toContain("WordPress owns");
    expect(html).toContain("Adoption day this Saturday");
    expect(html).not.toContain("Application Password");
  });

  it("passes a persisted degraded state through to the operator surface", async () => {
    mocks.auth.mockResolvedValue({ user: { platformRole: "superadmin", isSuperuser: true } });
    mocks.can.mockReturnValue(true);
    mocks.readSetupState.mockResolvedValue({
      integrationId: "wordpress-self-hosted",
      provider: "wordpress",
      status: "degraded",
      safeProjection: { siteName: "Second Chance Rescue", siteUrl: "https://rescue.example" },
      lastErrorMsg: "WordPress could not be reached safely.",
      lastTestedAt: new Date("2026-08-22T07:00:00.000Z"),
    });
    mocks.projectionCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    mocks.projectionFindMany.mockResolvedValue([]);
    mocks.publicationFindMany.mockResolvedValue([]);

    const { default: Page } = await import("./page");
    const html = renderToStaticMarkup(await Page());

    expect(html).toContain('data-status="degraded"');
  });
});
