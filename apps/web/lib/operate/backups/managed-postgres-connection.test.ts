import { expect, it } from "vitest";
import { managedPostgresConnection } from "./managed-postgres-connection";

it("keeps the configured database identity and TLS without forwarding Prisma-only options", () => {
  const result = managedPostgresConnection("postgresql://operator:example@postgres:5432/database?schema=public&connection_limit=4&sslmode=require");
  expect(result).toEqual({
    PGDATABASE: "postgresql://operator:example@postgres:5432/database?sslmode=require",
    POSTGRES_USER: "operator", POSTGRES_DB: "database",
  });
});

it("refuses multiple targets, a database selector in query parameters, or invalid connection strings", () => {
  for (const value of [
    "", "postgresql://dpf@postgres", "https://postgres/dpf",
    "postgresql://dpf@postgres,dpf-postgres/dpf", "postgresql://dpf@postgres/dpf?host=other-postgres",
  ]) expect(() => managedPostgresConnection(value)).toThrow("managed_postgres_connection_unproven");
});
