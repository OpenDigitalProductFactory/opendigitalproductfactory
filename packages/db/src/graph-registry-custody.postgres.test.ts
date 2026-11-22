import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { buildDestinationResetSql, runWithDestinationCleanup } from "./sanitized-clone";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

// These fixtures need an admitted disposable DB, but never target its installed
// tables. Every unqualified relation is asserted to resolve to this connection's
// pg_temp namespace before executing source SQL. Entire fixtures roll back.
describeDatabase("graph registry custody recovery TEMP fixtures", () => {
  it("restores completed-history dictionary drift without changing history, including interrupted insert and repeat", async () => {
    const temp = new Client({ connectionString: databaseUrl });
    const registry = readFileSync(new URL("../prisma/migrations/20261028060000_graph_relation_type/migration.sql", import.meta.url), "utf8");
    const inserts = registry.match(/INSERT INTO "graph_relation_type"[^;]*;/g);
    expect(inserts).toHaveLength(1);
    const insert = inserts![0];
    const expected = [...insert.matchAll(/^\s*\('([A-Z_]+)',/gm)].map(match => match[1]);
    await temp.connect();
    try {
      await temp.query("BEGIN");
      await temp.query("SET LOCAL search_path TO pg_temp, pg_catalog");
      await temp.query(`CREATE TEMP TABLE graph_relation_type (key text PRIMARY KEY, relation_class text, label text, inverse_label text, status text);
        CREATE TEMP TABLE _prisma_migrations (migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz, applied_steps_count integer);
        INSERT INTO graph_relation_type VALUES ('RUNS_ON','semantic','retained custom label','inverse','retired'),('CUSTOM_LINK','semantic','custom','custom','active');
        INSERT INTO _prisma_migrations VALUES
          ('20261028060000_graph_relation_type','b0b76a1bfceaa4909e00c3e820d9c103b5098d7f122054ff52c2b116f0a703b8',now(),null,1),
          ('20261114130000_relation_drift_repair','2606adc435559392f8a9804ce6afbfb2e71708cfeeed5e08a782be2766b5edfa',null,now(),0),
          ('20261114130000_relation_drift_repair','2606adc435559392f8a9804ce6afbfb2e71708cfeeed5e08a782be2766b5edfa',now(),null,1)`);
      expect((await temp.query(`SELECT count(*)::int AS count FROM pg_class
        WHERE oid IN ('graph_relation_type'::regclass,'_prisma_migrations'::regclass)
          AND relnamespace=pg_my_temp_schema()`)).rows[0].count).toBe(2);
      const history = async () => (await temp.query("SELECT * FROM _prisma_migrations ORDER BY migration_name,applied_steps_count")).rows;
      const before = await history();
      await temp.query(`CREATE FUNCTION pg_temp.reject_registry_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.key='PART_OF' THEN RAISE EXCEPTION 'fixture interrupted insert'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_registry_fixture BEFORE INSERT ON graph_relation_type FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_registry_fixture()`);
      await temp.query("SAVEPOINT interrupted_restore");
      await expect(temp.query(insert)).rejects.toThrow("fixture interrupted insert");
      await temp.query("ROLLBACK TO SAVEPOINT interrupted_restore");
      expect((await temp.query("SELECT key FROM graph_relation_type ORDER BY key")).rows.map(row => row.key)).toEqual(["CUSTOM_LINK", "RUNS_ON"]);
      expect(await history()).toEqual(before);
      await temp.query("DROP TRIGGER reject_registry_fixture ON graph_relation_type");
      await temp.query(insert);
      const restored = (await temp.query("SELECT * FROM graph_relation_type ORDER BY key")).rows;
      expect(restored.map(row => row.key)).toEqual(expect.arrayContaining(expected));
      expect(restored.find(row => row.key === "RUNS_ON")).toMatchObject({ label: "retained custom label", status: "retired" });
      await temp.query(insert);
      expect((await temp.query("SELECT * FROM graph_relation_type ORDER BY key")).rows).toEqual(restored);
      expect(await history()).toEqual(before);
    } finally {
      await temp.query("ROLLBACK");
      await temp.end();
    }
  });

  it.each([false, true])("retains migration-owned dictionary across clone cleanup, failed=%s", async failCopy => {
    const temp = new Client({ connectionString: databaseUrl });
    await temp.connect();
    try {
      await temp.query("BEGIN");
      await temp.query("SET LOCAL search_path TO pg_temp, pg_catalog");
      await temp.query(`CREATE TEMP TABLE graph_relation_type (key text PRIMARY KEY);
        CREATE TEMP TABLE _prisma_migrations (migration_name text, finished_at timestamptz);
        CREATE TEMP TABLE clone_business (id text);
        INSERT INTO graph_relation_type VALUES ('PART_OF'), ('DEPENDS_ON');
        INSERT INTO _prisma_migrations VALUES ('fixture', now());
        INSERT INTO clone_business VALUES ('old')`);
      const bindings = await temp.query(`SELECT count(*)::int AS count FROM pg_class
        WHERE oid IN ('graph_relation_type'::regclass,'_prisma_migrations'::regclass,'clone_business'::regclass)
          AND relnamespace = pg_my_temp_schema()`);
      expect(bindings.rows[0].count).toBe(3);
      const reset = buildDestinationResetSql(["graph_relation_type", "_prisma_migrations", "clone_business"]);
      expect(reset).not.toBeNull();
      const copy = runWithDestinationCleanup(async () => { await temp.query(reset!); }, async () => {
        await temp.query("INSERT INTO clone_business VALUES ('new')");
        if (failCopy) throw new Error("fixture copy failure");
      });
      if (failCopy) await expect(copy).rejects.toThrow("fixture copy failure");
      else await copy;
      expect((await temp.query("SELECT key FROM graph_relation_type ORDER BY key")).rows.map(r => r.key)).toEqual(["DEPENDS_ON", "PART_OF"]);
      expect((await temp.query("SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL")).rows[0].count).toBe(1);
      expect((await temp.query("SELECT count(*)::int AS count FROM clone_business")).rows[0].count).toBe(failCopy ? 0 : 1);
    } finally {
      await temp.query("ROLLBACK");
      await temp.end();
    }
  });

  it("repeats the immutable relation-drift SQL after restoring missing original reference rows", async () => {
    const temp = new Client({ connectionString: databaseUrl });
    const migration = readFileSync(new URL("../prisma/migrations/20261114130000_relation_drift_repair/migration.sql", import.meta.url), "utf8");
    const registry = readFileSync(new URL("../prisma/migrations/20261028060000_graph_relation_type/migration.sql", import.meta.url), "utf8");
    const insert = registry.match(/INSERT INTO "graph_relation_type"[^;]*;/g);
    expect(insert).toHaveLength(1);
    await temp.connect();
    try {
      await temp.query("BEGIN");
      await temp.query("SET LOCAL search_path TO pg_temp, pg_catalog");
      await temp.query(`
        CREATE TEMP TABLE graph_relation_type (key text PRIMARY KEY, relation_class text, label text, inverse_label text, status text);
        CREATE TEMP TABLE "InventoryRelationship" (id text, "fromEntityId" text, "toEntityId" text, "relationshipType" text, properties jsonb);
        CREATE TEMP TABLE "DiscoveredRelationship" ("inventoryRelationshipId" text, "relationshipType" text);
        CREATE TEMP TABLE "InventoryEntity" (id text, "entityKey" text);
        CREATE TEMP TABLE "DigitalProduct" (id text, "productId" text);
        CREATE TEMP TABLE "ProductDependency" ("fromProductId" text, "toProductId" text, "relationType" text);
        CREATE TEMP TABLE graph_edge (src_key text, dst_key text, rel_type text, props jsonb, PRIMARY KEY(src_key,dst_key,rel_type),
          CONSTRAINT graph_edge_rel_type_fkey FOREIGN KEY(rel_type) REFERENCES graph_relation_type(key));
        INSERT INTO graph_relation_type VALUES ('RUNS_ON','semantic','keep custom label','inverse','retired'),
          ('DOC_REFERENCES','provenance','old reference','inverse','deprecated');
        INSERT INTO "InventoryEntity" VALUES ('h1','host1'),('h2','host2');
        INSERT INTO "InventoryRelationship" VALUES ('r','h1','h2','RUNS_ON','{"rule":"host_is_docker_host"}');
        INSERT INTO "DiscoveredRelationship" VALUES ('r','RUNS_ON');
        INSERT INTO graph_edge VALUES ('host1','host2','RUNS_ON','{}'),
          ('doc1','doc2','DOC_REFERENCES','{"refType":"canonical-source"}'),
          ('doc3','doc4','DOC_REFERENCES','{"refType":"unrecognized"}');
        INSERT INTO "DigitalProduct" VALUES ('p1','product1'),('p2','product2');
        INSERT INTO "ProductDependency" VALUES ('p1','p2','part_of'),('p2','p1','depends_on');
      `);
      const names = ["graph_relation_type", "InventoryRelationship", "DiscoveredRelationship", "InventoryEntity", "DigitalProduct", "ProductDependency", "graph_edge"];
      const bindings = await temp.query(`SELECT count(*)::int AS count FROM pg_class
        WHERE oid = ANY(ARRAY(SELECT to_regclass(quote_ident(name)) FROM unnest($1::text[]) AS t(name)))
          AND relnamespace = pg_my_temp_schema()`, [names]);
      expect(bindings.rows[0].count).toBe(names.length);
      // Actual failed SQL can have committed earlier statements before failure.
      // Apply its prefix, then isolate the projection's demonstrated 23503.
      const split = migration.indexOf("-- 5. Graph:");
      expect(split).toBeGreaterThan(0);
      await temp.query(migration.slice(0, split));
      await temp.query("SAVEPOINT expected_failure");
      await expect(temp.query(migration.slice(split))).rejects.toMatchObject({ code: "23503", constraint: "graph_edge_rel_type_fkey" });
      await temp.query("ROLLBACK TO SAVEPOINT expected_failure");
      await temp.query(insert![0]);
      const snapshot = async () => (await temp.query(`SELECT src_key,dst_key,rel_type,props FROM graph_edge ORDER BY src_key,dst_key,rel_type`)).rows;
      await temp.query(migration);
      const first = await snapshot();
      expect(first).toEqual(expect.arrayContaining([
        { src_key: "product1", dst_key: "product2", rel_type: "PART_OF", props: { source: "ProductDependency" } },
        { src_key: "product2", dst_key: "product1", rel_type: "DEPENDS_ON", props: { source: "ProductDependency" } },
        { src_key: "host1", dst_key: "host2", rel_type: "SAME_AS", props: {} },
        { src_key: "doc1", dst_key: "doc2", rel_type: "HAD_PRIMARY_SOURCE", props: { refType: "canonical-source" } },
        { src_key: "doc3", dst_key: "doc4", rel_type: "DOC_REFERENCES", props: { refType: "unrecognized" } },
      ]));
      await temp.query(insert![0]);
      await temp.query(migration);
      expect(await snapshot()).toEqual(first);
      expect((await temp.query("SELECT label,status FROM graph_relation_type WHERE key='RUNS_ON'")).rows).toEqual([{ label: "keep custom label", status: "retired" }]);
      expect((await temp.query('SELECT "relationshipType" FROM "DiscoveredRelationship"')).rows).toEqual([{ relationshipType: "SAME_AS" }]);
    } finally {
      await temp.query("ROLLBACK");
      await temp.end();
    }
  });
});

