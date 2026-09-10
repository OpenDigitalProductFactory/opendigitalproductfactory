/**
 * Structural guard test for the DPF_BACKUPS_HOST_PATH relocation
 * (BI-8004BCD8). Locks down the contract surface so a future edit
 * cannot silently regress backups back into the install root.
 *
 * Why a structural test, not an integration test: the live
 * bind-mount + docker-in-docker dump flow requires a running Docker
 * daemon, which CI does not provide. The substantive risk is exactly
 * the kind a structural guard catches: someone editing one of these
 * files in isolation and dropping the env-var wiring on the floor.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §5.3
 * BI:   BI-8004BCD8 (DR-hardening epic)
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// __dirname = apps/web/lib/operate/backups → 5 `..` to reach repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("DPF_BACKUPS_HOST_PATH relocation (BI-8004BCD8)", () => {
  describe("docker-compose.yml", () => {
    const compose = read("docker-compose.yml");

    it("portal + promoter bind mounts read DPF_BACKUPS_HOST_PATH with legacy fallback", () => {
      const pattern =
        "${DPF_BACKUPS_HOST_PATH:-${DPF_HOST_INSTALL_PATH:-.}/backups}:/backups";
      // Two services use the backups bind: portal and promoter.
      const occurrences = compose.split(pattern).length - 1;
      expect(occurrences, "expected both portal and promoter to use the new bind pattern").toBe(2);
    });

    it("portal service forwards DPF_BACKUPS_HOST_PATH so bash scripts can read it", () => {
      expect(compose).toContain("DPF_BACKUPS_HOST_PATH: ${DPF_BACKUPS_HOST_PATH:-}");
    });

    it("does not leave the bare legacy bind mount in place", () => {
      // The legacy pattern (without the relocation override) should no
      // longer appear as a bind mount. It can still appear in comments
      // — strip lines that begin with optional whitespace then '#'.
      const lines = compose
        .split("\n")
        .filter((line) => !/^\s*#/.test(line));
      const legacy = "- ${DPF_HOST_INSTALL_PATH:-.}/backups:/backups";
      const stillThere = lines.filter((line) => line.includes(legacy));
      expect(stillThere, `legacy bind mount remains: ${stillThere.join("\\n")}`).toHaveLength(0);
    });
  });

  describe("runtime image", () => {
    const dockerfile = read("Dockerfile");
    const managedScripts = [
      "backup-postgres.sh",
      "restore-postgres.sh",
      "postgres-trial-restore.sh",
    ];

    it("runtime image packages the managed backup and restore scripts", () => {
      for (const script of managedScripts) {
        expect(dockerfile, `${script} must be copied into /app/scripts`).toContain(
          `scripts/${script}`,
        );
      }
      expect(dockerfile).toContain("COPY --from=init /app/scripts ./scripts");
    });

    it("runtime image does not package retired graph or vector backup scripts", () => {
      for (const script of [
        "backup-neo4j.sh",
        "backup-qdrant.sh",
        "restore-neo4j.sh",
        "restore-qdrant.sh",
      ]) {
        expect(dockerfile, `${script} must remain outside the runtime image`).not.toContain(
          `COPY scripts/${script}`,
        );
      }
    });

    it("retired graph or vector backup scripts are no longer in the repo (BET-5 / BI-B1977CEE)", () => {
      for (const script of [
        "scripts/backup-neo4j.sh",
        "scripts/backup-qdrant.sh",
        "scripts/restore-neo4j.sh",
        "scripts/restore-qdrant.sh",
      ]) {
        expect(existsSync(join(REPO_ROOT, script)), `${script} must stay deleted`).toBe(false);
      }
    });
  });

  describe("installer .env writers", () => {
    it(".env.docker.example documents DPF_BACKUPS_HOST_PATH", () => {
      expect(read(".env.docker.example")).toMatch(/^DPF_BACKUPS_HOST_PATH=/m);
    });

    it("install-dpf.ps1 writes DPF_BACKUPS_HOST_PATH=$DPF_DIR-backups", () => {
      expect(read("install-dpf.ps1")).toContain("DPF_BACKUPS_HOST_PATH=$backupsHostDir");
    });

    it("install-dpf.sh appends DPF_BACKUPS_HOST_PATH to a freshly-generated .env", () => {
      const body = read("install-dpf.sh");
      expect(body).toContain("DPF_BACKUPS_HOST_PATH=%s-backups");
      expect(body).toContain('BACKUPS_HOST_DIR="${REPO_ROOT}-backups"');
    });

    it("fresh-install.ps1 writes DPF_BACKUPS_HOST_PATH=$InstallRoot-backups", () => {
      expect(read("scripts/fresh-install.ps1")).toContain(
        "DPF_BACKUPS_HOST_PATH=$InstallRoot-backups",
      );
    });

    it("scratch-install-rehearsal.ps1 writes DPF_BACKUPS_HOST_PATH=$installPathForEnv-backups", () => {
      expect(read("scripts/scratch-install-rehearsal.ps1")).toContain(
        "DPF_BACKUPS_HOST_PATH=$installPathForEnv-backups",
      );
    });

    for (const cloud of ["gcp", "azure", "aws"]) {
      it(`terraform single-vm ${cloud} installer writes DPF_BACKUPS_HOST_PATH=$DPF_DIR-backups`, () => {
        const body = read(`infra/terraform/single-vm/${cloud}/user-data/install.sh`);
        expect(body).toContain("DPF_BACKUPS_HOST_PATH=$DPF_DIR-backups");
      });
    }
  });
});
