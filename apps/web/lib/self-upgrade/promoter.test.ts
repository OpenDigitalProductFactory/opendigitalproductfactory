import { describe, it, expect } from "vitest";
import { buildPromoterCommand } from "./promoter";

const BASE = {
  hostInstallPath: "/Users/me/dpf",
  targetSha: "abc1234",
  backupPath: "/backups/self-upgrade/run-1",
  healthUrl: "http://localhost:3000/api/health",
};

describe("buildPromoterCommand", () => {
  it("launches the promoter as a sibling container, not bash in-portal", () => {
    const { command, args } = buildPromoterCommand(BASE);
    const joined = args.join(" ");

    // The previous defect spawned bash against an in-portal script. The
    // promoter must run as a separate docker container instead.
    expect(command).toBe("docker");
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(joined).not.toContain("bash");
    expect(joined).not.toContain("promote.sh");
    expect(joined).not.toContain("scripts/");
  });

  it("mounts the docker socket and the host source tree read-only", () => {
    const { args } = buildPromoterCommand(BASE);
    expect(args).toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(args).toContain("/Users/me/dpf:/host-source:ro");
  });

  it("passes the promote contract via env and targets the promoter image", () => {
    const { args } = buildPromoterCommand(BASE);
    expect(args).toContain("PROMOTE_SOURCE=/host-source");
    expect(args).toContain("PROMOTE_TARGET_SHA=abc1234");
    expect(args).toContain("PROMOTE_BACKUP_PATH=/backups/self-upgrade/run-1");
    // localhost is rewritten to host.docker.internal so the sibling promoter
    // container can reach the recreated portal's published host port.
    expect(args).toContain("PROMOTE_HEALTH_URL=http://host.docker.internal:3000/api/health");
    expect(args).toContain("--add-host");
    expect(args).toContain("host.docker.internal:host-gateway");
    // Image is a positional arg followed by the entrypoint flag.
    expect(args).toContain("dpf-promoter");
    expect(args).toContain("--self-upgrade");
    expect(args.indexOf("dpf-promoter")).toBeLessThan(args.indexOf("--self-upgrade"));
  });

  it("honors a custom promoter image", () => {
    const { args } = buildPromoterCommand({ ...BASE, promoterImage: "ghcr.io/x/dpf-promoter:v1" });
    expect(args).toContain("ghcr.io/x/dpf-promoter:v1");
    expect(args).not.toContain("dpf-promoter");
  });

  it("appends --dry-run only when requested", () => {
    expect(buildPromoterCommand(BASE).args).not.toContain("--dry-run");
    expect(buildPromoterCommand({ ...BASE, dryRun: true }).args).toContain("--dry-run");
    // --dry-run must come after the image + --self-upgrade entrypoint flag.
    const dry = buildPromoterCommand({ ...BASE, dryRun: true }).args;
    expect(dry.indexOf("--self-upgrade")).toBeLessThan(dry.indexOf("--dry-run"));
  });

  it("mounts the backups volume only when a host path is provided", () => {
    expect(buildPromoterCommand(BASE).args).not.toContain("/backups");
    const withBackup = buildPromoterCommand({ ...BASE, backupHostPath: "/Users/me/dpf-backups" });
    expect(withBackup.args).toContain("/Users/me/dpf-backups:/backups");
  });

  it("mounts the install env file for compose interpolation when provided", () => {
    const { args } = buildPromoterCommand({
      ...BASE,
      hostInstallPath: "/Users/me/dpf/.upgrade-workspace",
      composeEnvFileHostPath: "/Users/me/dpf/.env",
    });

    expect(args).toContain("/Users/me/dpf/.upgrade-workspace:/host-source:ro");
    expect(args).toContain("/Users/me/dpf/.env:/install-env/.env:ro");
    expect(args).toContain("PROMOTE_COMPOSE_ENV_FILE=/install-env/.env");
  });
});
