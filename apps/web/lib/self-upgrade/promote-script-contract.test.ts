import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPromoterDockerArgs } from "./promoter";

const config = {
  enabled: true,
  hostInstallPath: "D:/DPF",
  hostSourceMountPath: "/host-source",
  composeProject: "dpf",
  portalContainerName: "dpf-portal-1",
  dbContainerName: "dpf-postgres-1",
  repositoryRemote: "origin",
  repositoryBranch: "main",
  healthUrl: "http://localhost:3000/api/health",
};

function envValue(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`));
}

describe("promoter script contract", () => {
  it("keeps docker env names aligned with scripts/promote.sh", () => {
    const args = buildPromoterDockerArgs(
      config,
      "SUR-12345678",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const script = readFileSync(resolve(process.cwd(), "..", "..", "scripts", "promote.sh"), "utf8");
    const requiredEnvNames = [
      "SELF_UPGRADE_RUN_ID",
      "SELF_UPGRADE_TARGET_SHA",
      "DPF_HOST_SOURCE_PATH",
      "DPF_COMPOSE_PROJECT",
      "DPF_PORTAL_CONTAINER",
      "DPF_PRODUCTION_DB_CONTAINER",
      "DPF_SELF_UPGRADE_REMOTE",
      "DPF_SELF_UPGRADE_BRANCH",
      "DPF_SELF_UPGRADE_HEALTH_URL",
    ];

    for (const name of requiredEnvNames) {
      expect(envValue(args, name), `${name} missing from promoter docker args`).toBeTruthy();
      expect(script, `${name} missing from promote.sh`).toContain(name);
    }
    expect(args.at(-1)).toBe("--self-upgrade");
  });
});
