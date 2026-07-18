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
import { readFileSync } from "node:fs";
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

  describe("scripts/backup-neo4j.sh + scripts/restore-neo4j.sh", () => {
    for (const script of ["scripts/backup-neo4j.sh", "scripts/restore-neo4j.sh"]) {
      describe(script, () => {
        const body = read(script);

        it("reads DPF_BACKUPS_HOST_PATH from env", () => {
          expect(body).toContain('DPF_BACKUPS_HOST_PATH="${DPF_BACKUPS_HOST_PATH:-}"');
        });

        it("prefers DPF_BACKUPS_HOST_PATH and falls back to DPF_HOST_INSTALL_PATH/backups", () => {
          expect(body).toContain('if [ -n "$DPF_BACKUPS_HOST_PATH" ]; then');
          expect(body).toContain('HOST_BACKUPS_BASE="$DPF_BACKUPS_HOST_PATH"');
          expect(body).toContain('elif [ -n "$DPF_HOST_INSTALL_PATH" ]; then');
          expect(body).toContain('HOST_BACKUPS_BASE="${DPF_HOST_INSTALL_PATH}/backups"');
        });

        it("uses HOST_BACKUPS_BASE for the docker-in-docker bind path (not the raw install path)", () => {
          // Old pattern referenced ${DPF_HOST_INSTALL_PATH}/backups/${...}
          // directly when building the host bind path. The new pattern goes
          // through HOST_BACKUPS_BASE.
          expect(body).toMatch(/HOST_BACKUPS_BASE\}\/\$\{(?:TARGET_REL|DUMP_RELATIVE)\}/);
          expect(body).not.toMatch(/HOST_TARGET_DIR="\$\{DPF_HOST_INSTALL_PATH\}\/backups\/\$\{TARGET_REL\}"/);
          expect(body).not.toMatch(/HOST_DUMP_DIR="\$\{DPF_HOST_INSTALL_PATH\}\/backups\/\$\{DUMP_RELATIVE\}"/);
        });
      });
    }
  });

  describe("TypeScript runners", () => {
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

    it("neo4j-backup-runner.ts forwards DPF_BACKUPS_HOST_PATH explicitly", () => {
      const body = read("apps/web/lib/operate/backups/neo4j-backup-runner.ts");
      expect(body).toContain('DPF_BACKUPS_HOST_PATH: process.env.DPF_BACKUPS_HOST_PATH ?? ""');
    });

    it("neo4j-restore-runner.ts forwards DPF_BACKUPS_HOST_PATH explicitly", () => {
      const body = read("apps/web/lib/operate/backups/neo4j-restore-runner.ts");
      expect(body).toContain('DPF_BACKUPS_HOST_PATH: process.env.DPF_BACKUPS_HOST_PATH ?? ""');
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
