// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AuthError from "./error";

function stubFetch(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => body })));
}

describe("(auth)/error boundary (BI-57D91FF0)", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the upgrade hold, not the generic card, when the platform is quiescing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({ level: "draining", runId: "QR-2026-09-18-xq990684" });
    render(<AuthError error={new Error("An unexpected response was received from the server.")} reset={() => {}} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/upgrading itself/));
    expect(screen.queryByText("Sign-in hit a problem")).toBeNull();
  });

  it("keeps the generic card when the platform is not quiescing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({ level: "normal", runId: null });
    render(<AuthError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByText("Sign-in hit a problem")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Sign-in hit a problem")).toBeTruthy());
  });
});
