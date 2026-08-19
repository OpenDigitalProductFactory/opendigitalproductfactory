import { describe, expect, it } from "vitest";

import { parseDockerInspectJson } from "./docker-compose-inspector";

describe("parseDockerInspectJson", () => {
  it("extracts compose ownership labels", () => {
    const parsed = parseDockerInspectJson(JSON.stringify([{
      Id: "abc123",
      Name: "/dpf-sandbox-1",
      State: { Status: "running", Running: true },
      Config: {
        Labels: {
          "com.docker.compose.project": "dpf",
          "com.docker.compose.service": "sandbox",
          "com.docker.compose.project.working_dir": "D:\\DPF-clean-main-linux",
          "com.docker.compose.project.config_files": "D:\\DPF-clean-main-linux\\docker-compose.yml",
        },
      },
      NetworkSettings: { Ports: { "3035/tcp": [{ HostPort: "3035" }] } },
    }]));

    expect(parsed?.containerName).toBe("dpf-sandbox-1");
    expect(parsed?.status).toBe("running");
    expect(parsed?.composeProjectName).toBe("dpf");
    expect(parsed?.composeServiceName).toBe("sandbox");
    expect(parsed?.composeWorkingDir).toBe("D:\\DPF-clean-main-linux");
    expect(parsed?.composeConfigFiles).toEqual(["D:\\DPF-clean-main-linux\\docker-compose.yml"]);
    expect(parsed?.hostPorts).toEqual([3035]);
  });

  it("returns null for empty inspect output", () => {
    expect(parseDockerInspectJson("[]")).toBeNull();
  });
});
