import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client";

// Qualification harness only. No root DATABASE_URL fallback or live client.
// A separate schema preserves other slot data while ORM and raw queries agree.
export function createIngestionPostgresFixture() {
  const connectionString = process.env.DPF_INGESTION_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("An admitted ingestion test database is required");
  const schema = process.env.DPF_INGESTION_TEST_SCHEMA ?? "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid ingestion test schema");
  return new PrismaClient({adapter: new PrismaPg({connectionString,
    options: `-c search_path=${schema},public`}, {schema})});
}
