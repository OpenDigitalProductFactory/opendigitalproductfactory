// BI-43BBCC26: a failed street-map install records the failure and removes the
// failed pack's staging folder, read from the ORIGINAL event payload.
import { beforeEach, describe, expect, it, vi } from "vitest";

const jobsMock = vi.hoisted(() => ({ createFunction: vi.fn() }));
const install = vi.hoisted(() => ({ writeInstallStatus: vi.fn(), discardStaging: vi.fn() }));

vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: (...args: unknown[]) => jobsMock.createFunction(...args) },
}));
vi.mock("@/lib/twin/map-pack-install/status.server", () => ({
  writeInstallStatus: (...args: unknown[]) => install.writeInstallStatus(...args),
}));
vi.mock("@/lib/twin/map-pack-install/install.server", () => ({
  discardStaging: (...args: unknown[]) => install.discardStaging(...args),
}));

type Defined = {
  config: { id: string; concurrency: unknown; onFailure: (args: unknown) => Promise<void> };
};

async function load(): Promise<Defined> {
  vi.resetModules();
  jobsMock.createFunction.mockImplementation((config, handler) => ({ config, handler }));
  const { mapPackInstall } = await import("./map-pack-install");
  return mapPackInstall as unknown as Defined;
}

beforeEach(() => {
  vi.clearAllMocks();
  install.writeInstallStatus.mockResolvedValue(undefined);
  install.discardStaging.mockResolvedValue(undefined);
});

describe("map-pack/install", () => {
  it("runs one install at a time", async () => {
    const fn = await load();
    expect(fn.config).toMatchObject({ id: "map-pack/install", concurrency: [{ limit: 1 }] });
  });

  it("records the failure and discards the failed pack's staging on terminal failure", async () => {
    const fn = await load();
    await fn.config.onFailure({
      event: { data: { event: { name: "map-pack/install.requested", data: { packId: "us-kansas", region: "Kansas" } } } },
      error: new Error("If-Match failed: the planet build changed"),
    });
    expect(install.writeInstallStatus).toHaveBeenCalledWith({ state: "failed", error: "If-Match failed: the planet build changed" });
    expect(install.discardStaging).toHaveBeenCalledWith("us-kansas");
  });

  it("still records the failure when the original event carries no pack id", async () => {
    const fn = await load();
    await fn.config.onFailure({ event: { data: { event: { data: {} } } }, error: "boom" });
    expect(install.writeInstallStatus).toHaveBeenCalledWith({ state: "failed", error: "The install stopped." });
    expect(install.discardStaging).not.toHaveBeenCalled();
  });
});
