import { describe, expect, it, vi, beforeEach } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
);

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import EaAgentsPage from "./page";

const AI_COWORKER_IDENTITY_ROUTE = "/platform/identity/agents";

describe("/ea/agents legacy route", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("redirects to the canonical AI coworker identity surface", () => {
    expect(() => EaAgentsPage()).toThrow(
      `redirect:${AI_COWORKER_IDENTITY_ROUTE}`,
    );
    expect(redirectMock).toHaveBeenCalledWith(AI_COWORKER_IDENTITY_ROUTE);
  });
});
