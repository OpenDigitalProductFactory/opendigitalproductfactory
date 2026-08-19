import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "user-1", platformRole: "admin", isSuperuser: true },
  }),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn().mockReturnValue(false),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: (name: string) => (name === "host" ? "localhost:3000" : null),
  }),
}));

vi.mock("@/lib/inference/ai-provider-data", () => ({
  getProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    buildEngine: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/build/build-studio-config", () => ({
  getBuildStudioConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/mcp/contributor-readiness", () => ({
  getContributorMcpReadiness: vi.fn().mockResolvedValue({
    status: "ready",
    recommendedAction: "test_connection",
    identityBinding: "available",
    token: null,
    missingGrants: [],
    requiredGrants: [],
    recommendedScopes: [],
    probe: { status: "not_run" },
  }),
}));

vi.mock("@/lib/mcp-token-scopes", () => ({
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS: [],
  getMcpTokenTemplate: vi.fn().mockReturnValue({ grants: [] }),
}));

vi.mock("@/components/platform/BuildStudioConfigForm", () => ({
  BuildStudioConfigForm: () => <div>build-studio-config-form</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: any; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("BuildStudioPage", () => {
  it("links operators back to the AI readiness console", async () => {
    const { default: BuildStudioPage } = await import("./page");
    const html = renderToStaticMarkup(await BuildStudioPage());

    expect(html).toContain("Build Studio Runtime");
    expect(html).toContain("build-studio-config-form");
    expect(html).toContain('href="/platform/ai/readiness"');
  });
});
