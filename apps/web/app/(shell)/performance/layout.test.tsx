import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockAuth, mockNotFound } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

import PerformanceLayout from "./layout";

describe("PerformanceLayout", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockNotFound.mockClear();
  });

  it("server-denies a workforce member", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-600", isSuperuser: false },
    });

    await expect(
      PerformanceLayout({ children: <p>Private performance</p> }),
    ).rejects.toThrow("not-found");
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it("renders for an authorized owner", async () => {
    mockAuth.mockResolvedValue({
      user: { platformRole: "HR-000", isSuperuser: false },
    });

    const result = await PerformanceLayout({
      children: <p>Private performance</p>,
    });

    expect(renderToStaticMarkup(result)).toContain("Private performance");
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
