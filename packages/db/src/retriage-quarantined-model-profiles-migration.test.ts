import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test for 20260724150000_retriage_quarantined_model_profiles
// (BI-84792669).
//
// The generic collation-drift dedupe (20260720193000) ranked ModelProfile
// duplicates without regard to profileSource, so a `seed` row could survive
// over an `evaluated` row — losing a measured toolFidelity and an admin
// capabilityOverrides pin. This migration re-triages already-quarantined
// rows: where a quarantined row now outranks its live sibling by the
// BI-84792669 precedence, it reclaims the natural key and the demoted row is
// retired via the tombstone convention from 20260721190000. Independently, a
// capabilityOverrides pin on ANY duplicate is copied onto the eventual
// survivor when the survivor has none.

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `retriage_model_profiles_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260724150000_retriage_quarantined_model_profiles/migration.sql",
);

async function migrationBody(): Promise<string> {
  const sql = await readFile(migrationPath, "utf8");
  return sql.replace(/^\s*BEGIN;\s*$/m, "").replace(/^\s*COMMIT;\s*$/m, "");
}

async function runMigration(): Promise<void> {
  const body = await migrationBody();
  await client.query(body);
}

type ProfileRow = {
  id: string;
  providerId: string;
  modelId: string;
  profileSource: string;
  evalCount: number;
  toolFidelity: number;
  lastEvalAt: Date | null;
  generatedAt: Date;
  capabilityOverrides: unknown;
  modelStatus: string;
  retiredAt: Date | null;
  retiredReason: string | null;
};

async function fetchById(id: string): Promise<ProfileRow> {
  const result = await client.query(
    `SELECT id, "providerId", "modelId", "profileSource", "evalCount", "toolFidelity",
            "lastEvalAt", "generatedAt", "capabilityOverrides", "modelStatus",
            "retiredAt", "retiredReason"
       FROM "ModelProfile" WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function seedModelProfileTable(): Promise<void> {
  await client.query(`
    CREATE TABLE "ModelProfile" (
      id TEXT PRIMARY KEY,
      "providerId" TEXT NOT NULL,
      "modelId" TEXT NOT NULL,
      "profileSource" TEXT NOT NULL DEFAULT 'seed',
      "evalCount" INT NOT NULL DEFAULT 0,
      "toolFidelity" INT NOT NULL DEFAULT 50,
      "lastEvalAt" TIMESTAMP(3),
      "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
      "capabilityOverrides" JSONB,
      "modelStatus" TEXT NOT NULL DEFAULT 'active',
      "retiredAt" TIMESTAMP(3),
      "retiredReason" TEXT
    );
  `);
}

describeDatabase("retriage quarantined ModelProfile rows migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await seedModelProfileTable();
  });

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });

  describe("the live qwen3-coder scenario (BI-84792669)", () => {
    beforeAll(async () => {
      // Mirrors the live rows exactly (ids, values) as read from production
      // via admin_query_db before this migration was authored.
      await client.query(`
        INSERT INTO "ModelProfile"
          (id, "providerId", "modelId", "profileSource", "evalCount", "toolFidelity",
           "lastEvalAt", "generatedAt", "capabilityOverrides", "modelStatus",
           "retiredAt", "retiredReason")
        VALUES
          ('cmqem1jz7043601ms0isbs1z1', 'local',
           '__dpf_quarantined__cmqem1jz7043601ms0isbs1z1__docker.io/ai/qwen3-coder:latest',
           'evaluated', 51, 100,
           '2026-07-19T15:05:42.665Z', '2026-07-15T03:10:04.445Z',
           '{"toolUse":true}'::jsonb, 'retired',
           '2026-07-21T20:45:38.377Z', 'model_not_found from provider'),
          ('cmrlkwpqx01968ds4rcvbqxj1', 'local',
           'docker.io/ai/qwen3-coder:latest',
           'seed', 2, 40,
           '2026-07-21T20:51:43.740Z', '2026-07-24T03:10:06.199Z',
           NULL, 'retired',
           '2026-07-21T20:51:43.761Z', 'Auto-retired: inference admission timeout on local engine after 120000ms (origin=interactive, provider=local)');
      `);
      await runMigration();
    });

    it("promotes the evaluated row onto the natural key", async () => {
      const promoted = await fetchById("cmqem1jz7043601ms0isbs1z1");
      expect(promoted.modelId).toBe("docker.io/ai/qwen3-coder:latest");
      expect(promoted.profileSource).toBe("evaluated");
      expect(promoted.toolFidelity).toBe(100);
    });

    it("preserves the capabilityOverrides pin on the promoted survivor", async () => {
      const promoted = await fetchById("cmqem1jz7043601ms0isbs1z1");
      expect(promoted.capabilityOverrides).toEqual({ toolUse: true });
    });

    it("does not touch the promoted row's own modelStatus/retiredAt/retiredReason (out of scope: reactivation is an operator decision)", async () => {
      const promoted = await fetchById("cmqem1jz7043601ms0isbs1z1");
      expect(promoted.modelStatus).toBe("retired");
      expect(promoted.retiredReason).toBe("model_not_found from provider");
    });

    it("demotes the former seed survivor to a quarantined key and retires it, preserving its original retiredReason", async () => {
      const demoted = await fetchById("cmrlkwpqx01968ds4rcvbqxj1");
      expect(demoted.modelId).toBe(
        "__dpf_quarantined__cmrlkwpqx01968ds4rcvbqxj1__docker.io/ai/qwen3-coder:latest",
      );
      expect(demoted.modelStatus).toBe("retired");
      expect(demoted.retiredReason).toBe(
        "Auto-retired: inference admission timeout on local engine after 120000ms (origin=interactive, provider=local)",
      );
    });

    it("leaves no duplicate (providerId, modelId) key", async () => {
      const dupes = await client.query(
        `SELECT "providerId", "modelId" FROM "ModelProfile" GROUP BY "providerId", "modelId" HAVING count(*) > 1`,
      );
      expect(dupes.rows).toHaveLength(0);
    });

    it("is idempotent — a second run changes nothing further", async () => {
      await runMigration(); // would reject/throw if the fail-closed guard tripped
      const promoted = await fetchById("cmqem1jz7043601ms0isbs1z1");
      expect(promoted.modelId).toBe("docker.io/ai/qwen3-coder:latest");
      const demoted = await fetchById("cmrlkwpqx01968ds4rcvbqxj1");
      expect(demoted.modelId).toBe(
        "__dpf_quarantined__cmrlkwpqx01968ds4rcvbqxj1__docker.io/ai/qwen3-coder:latest",
      );
    });
  });

  describe("pin-only merge — quarantined sibling has a pin, live survivor already correctly ranked", () => {
    beforeAll(async () => {
      await client.query(`
        INSERT INTO "ModelProfile"
          (id, "providerId", "modelId", "profileSource", "evalCount", "toolFidelity",
           "capabilityOverrides")
        VALUES
          ('live-b', 'openai', 'gpt-x', 'evaluated', 10, 90, NULL),
          ('q-b', 'openai',
           '__dpf_quarantined__q-b__gpt-x',
           'seed', 1, 30, '{"toolUse":false}'::jsonb);
      `);
      await runMigration();
    });

    it("keeps the live row's key unchanged", async () => {
      const live = await fetchById("live-b");
      expect(live.modelId).toBe("gpt-x");
      expect(live.profileSource).toBe("evaluated");
    });

    it("copies the quarantined sibling's pin onto the survivor", async () => {
      const live = await fetchById("live-b");
      expect(live.capabilityOverrides).toEqual({ toolUse: false });
    });

    it("does not un-quarantine the loser", async () => {
      const loser = await fetchById("q-b");
      expect(loser.modelId).toBe("__dpf_quarantined__q-b__gpt-x");
    });
  });

  describe("no-op groups", () => {
    beforeAll(async () => {
      // A live row with no quarantined sibling at all.
      await client.query(`
        INSERT INTO "ModelProfile" (id, "providerId", "modelId", "profileSource")
        VALUES ('solo', 'anthropic', 'claude-x', 'catalog');
      `);
      // A live row whose quarantined sibling correctly ranks lower (no swap, no pin to merge).
      await client.query(`
        INSERT INTO "ModelProfile"
          (id, "providerId", "modelId", "profileSource", "evalCount", "toolFidelity")
        VALUES
          ('live-c', 'openai', 'gpt-y', 'evaluated', 20, 95),
          ('q-c', 'openai', '__dpf_quarantined__q-c__gpt-y', 'seed', 1, 10);
      `);
      await runMigration();
    });

    it("leaves an unpaired live row untouched", async () => {
      const solo = await fetchById("solo");
      expect(solo.modelId).toBe("claude-x");
    });

    it("leaves a correctly-ranked live row untouched when there is nothing to merge", async () => {
      const live = await fetchById("live-c");
      expect(live.modelId).toBe("gpt-y");
      expect(live.capabilityOverrides).toBeNull();
      const loser = await fetchById("q-c");
      expect(loser.modelId).toBe("__dpf_quarantined__q-c__gpt-y");
    });
  });
});
