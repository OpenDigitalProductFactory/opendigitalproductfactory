import { describe, expect, it } from "vitest";

import type { TeardownEnvelope } from "./contract";
import { buildTeardownDockerCommand } from "./dispatcher";

const BASE_TIME = Date.UTC(2026, 7, 22, 12);

const envelope: TeardownEnvelope = {
  schemaVersion: 1,
  kind: "installation-teardown",
  runId: "TDR-ABC12345",
  issuedAt: new Date(BASE_TIME).toISOString(),
  expiresAt: new Date(BASE_TIME + 5 * 60_000).toISOString(),
  scope: "containers",
  actorRef: "user-1",
  installPath: "D:\\DPF",
  backupsPath: "D:\\DPF-backups",
  composeProject: "dpf",
  composeFiles: ["docker-compose.yml"],
  previewDigest: "a".repeat(64),
  salvageDigest: "b".repeat(64),
  recovery: null,
  confirmation: { mode: "non-destructive" },
};

describe("teardown sibling dispatcher", () => {
  it("mounts only the bounded roots and passes a signed plan without the secret", () => {
    const command = buildTeardownDockerCommand({
      envelope,
      signature: "c".repeat(64),
      promoterImage: "sha256:" + "d".repeat(64),
      stateDirHostPath: "C:\\Users\\operator\\.dpf",
    });
    expect(command.command).toBe("docker");
    expect(command.args).toContain("dpf-teardown-tdr-abc12345");
    expect(command.args).toContain("D:\\DPF:/install");
    expect(command.args).toContain("D:\\DPF-backups:/evidence");
    expect(command.args).toContain("C:\\Users\\operator\\.dpf/runtime-transition.secret:/run/secrets/dpf-runtime-transition:ro");
    expect(command.args).toContain("DPF_TEARDOWN_SIGNATURE=" + "c".repeat(64));
    expect(command.args).toContain("/promoter/governed-teardown.mjs");
    expect(command.args.join(" ")).not.toContain("runtime-transition.secret=");
    expect(command.args.at(-2)).toBe("sha256:" + "d".repeat(64));
    expect(command.args.at(-1)).toBe("/promoter/governed-teardown.mjs");
  });

  it("refuses missing host lifecycle state before spawning Docker", () => {
    expect(() => buildTeardownDockerCommand({
      envelope,
      signature: "c".repeat(64),
      promoterImage: "dpf-promoter",
      stateDirHostPath: "",
    })).toThrow("teardown_state_dir_missing");
  });
});
