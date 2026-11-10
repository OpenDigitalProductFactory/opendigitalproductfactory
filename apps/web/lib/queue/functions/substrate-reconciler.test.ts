import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { listSubstrateContainers } from "./substrate-reconciler";

// The Engine answers by container id; anything else 404s, as the live socket did.
function engine(selfId: string) {
  return vi.fn(async (path: string) => {
    if (path === `/containers/${selfId}/json`) {
      return { Config: { Labels: { "com.docker.compose.project": "dpf" } } };
    }
    if (path === "/containers/json?all=1") {
      return [
        { Id: "sbx", Names: ["/dpf-sandbox-1"], State: "exited", Labels: { "com.docker.compose.project": "dpf", "com.docker.compose.service": "sandbox" } },
        { Id: "other", Names: ["/happy_agnesi"], State: "running", Labels: {} },
      ];
    }
    if (path === "/containers/sbx/json") {
      return { HostConfig: { RestartPolicy: { Name: "unless-stopped" } }, State: { FinishedAt: "2026-10-07T07:12:01Z", ExitCode: 137 } };
    }
    throw new Error("docker_engine_http_404");
  });
}

describe("listSubstrateContainers (BI-4D08C53C live defect)", () => {
  it("finds its compose project through the OS hostname, not process.env.HOSTNAME", async () => {
    // The portal image sets HOSTNAME=0.0.0.0 as the Next.js bind address
    // (BI-3925A700); inspecting /containers/0.0.0.0/json 404'd on every run.
    vi.stubEnv("HOSTNAME", "0.0.0.0");
    const get = engine("4d01cb0bd417");
    const containers = await listSubstrateContainers(get, "4d01cb0bd417");
    expect(get).not.toHaveBeenCalledWith("/containers/0.0.0.0/json");
    expect(containers.find((c) => c.name === "dpf-sandbox-1")).toMatchObject({
      inProject: true,
      service: "sandbox",
      restartPolicy: "unless-stopped",
      stoppedAt: "2026-10-07T07:12:01Z",
      exitCode: 137,
    });
    vi.unstubAllEnvs();
  });

  it("an unreadable self-inspect lists containers as outside the project instead of failing the run", async () => {
    const get = engine("someone-else");
    const containers = await listSubstrateContainers(get, "4d01cb0bd417");
    expect(containers).toHaveLength(2);
    expect(containers.every((c) => !c.inProject)).toBe(true);
  });
});
