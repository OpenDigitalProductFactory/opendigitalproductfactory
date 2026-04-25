// apps/web/components/admin/TokenExpiryBanner.test.tsx
// Phase 6 of the 2026-04-24 GitHub auth 2FA readiness spec.
//
// Banner is server-rendered; we mock prisma.platformNotification.findFirst
// and assert the returned element. `info`-only severity is intentionally
// quiet (no banner) — only warning/critical/expired surface.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformNotification: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import TokenExpiryBanner from "./TokenExpiryBanner";

const mockFindFirst = vi.mocked(prisma.platformNotification.findFirst);

beforeEach(() => {
  vi.clearAllMocks();
});

function notification(severity: string, message: string) {
  return {
    id: "n1",
    severity,
    category: "token-expiry",
    subjectId: "github-contribution",
    message,
    createdAt: new Date("2026-04-24T09:00:00.000Z"),
    resolvedAt: null,
  } as Awaited<ReturnType<typeof prisma.platformNotification.findFirst>>;
}

describe("TokenExpiryBanner", () => {
  it("renders nothing when there is no active notification", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const element = await TokenExpiryBanner();
    expect(element).toBeNull();
  });

  it("queries for warning/critical/expired only (info is too quiet for a banner)", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await TokenExpiryBanner();
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        category: "token-expiry",
        resolvedAt: null,
        severity: { in: ["warning", "critical", "expired"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("renders a yellow warning banner with the message body", async () => {
    mockFindFirst.mockResolvedValueOnce(
      notification(
        "warning",
        "Your GitHub token expires in 14 days. Reconnect soon.",
      ),
    );
    const element = await TokenExpiryBanner();
    expect(element).not.toBeNull();
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Your GitHub token expires in 14 days");
    expect(html).toContain("yellow");
    expect(html).toContain("#connect-github");
    expect(html).toContain("#advanced-token");
  });

  it("renders a red critical banner", async () => {
    mockFindFirst.mockResolvedValueOnce(
      notification(
        "critical",
        "Your GitHub token expires in 7 days. Reconnect now to avoid disruption.",
      ),
    );
    const element = await TokenExpiryBanner();
    expect(element).not.toBeNull();
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("Your GitHub token expires in 7 days");
    expect(html).toContain("red");
  });

  it("renders a red expired banner with 'expired' copy", async () => {
    mockFindFirst.mockResolvedValueOnce(
      notification(
        "expired",
        "Your GitHub token has expired. Reconnect to resume contributing.",
      ),
    );
    const element = await TokenExpiryBanner();
    expect(element).not.toBeNull();
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain("expired");
    expect(html).toContain("red");
  });
});
