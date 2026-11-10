import { expect, it, vi } from "vitest";

vi.mock("@/lib/inference/host-gpu-admission", () => ({ assertLocalGpuFree: vi.fn() }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertLocalProviderCapacityAvailable: vi.fn() }));

it("serializes local inference and prioritizes interactive work across server module copies", async () => {
  // Instrumentation, route handlers and SSR can evaluate this module separately.
  // Reset the module cache to reproduce those independent copies in one process.
  vi.resetModules();
  const boot = await import("./resource-lane");
  let release!: () => void;
  const active = new Promise<void>((resolve) => { release = resolve; });
  const events: string[] = [];
  const holder = boot.withLocalInferenceLock(async () => {
    events.push("active-background");
    await active;
  }, { origin: "autonomous" });
  await vi.waitFor(() => expect(events).toEqual(["active-background"]));

  vi.resetModules();
  const request = await import("./resource-lane");
  const background = request.withLocalInferenceLock(async () => {
    events.push("queued-background");
  }, { origin: "autonomous" });
  const interactive = request.withLocalInferenceLock(async () => {
    events.push("interactive");
  }, { origin: "interactive" });

  try {
    // Give an incorrectly independent queue time to dispatch its callback.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["active-background"]);
  } finally {
    release();
    await Promise.all([holder, background, interactive]);
  }
  expect(events).toEqual(["active-background", "interactive", "queued-background"]);
});
