// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformBanner } from "./PlatformBanner";

const stream = vi.hoisted(() => ({ receive: null as null | ((event: object) => void) }));
vi.mock("@/lib/hooks/system-events", () => ({
  useSystemEvent: (_name: string, receive: (event: object) => void) => { stream.receive = receive; },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("recovers the exact deadline on a fresh tab, keeps it at dispatch, and ignores another run's clear", async () => {
  const deadline = "2026-11-25T16:05:00.000Z";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ runId: "QR-fixture", readyToSwapDeadlineAt: deadline }) })));
  const { container } = render(<PlatformBanner />);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Preparing recovery backups"));
  const instant = () => container.querySelector("time")?.getAttribute("datetime");
  expect(instant()).toBe(deadline);
  act(() => stream.receive?.({ level: "cleared", runId: "QR-other", outcome: "failed" }));
  expect(instant()).toBe(deadline);
  act(() => stream.receive?.({ level: "swapping", runId: "QR-fixture", readyToSwapDeadlineAt: deadline }));
  expect(screen.getByRole("status").textContent).toContain("Installing the platform update");
  expect(instant()).toBe(deadline);
});
