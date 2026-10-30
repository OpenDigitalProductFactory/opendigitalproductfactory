import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client";

/** Test-only, explicitly admitted database and isolated ORM/raw schema. */
export function createHandoffDependencyPostgresFixture(connectionString: string, schema: string) {
  if (!connectionString || !/^dpf_handoff_dependency_[a-f0-9]{32}$/.test(schema)) throw new Error("An isolated handoff qualification schema is required");
  const queries: Array<{ query: string; params: string }> = [];
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
    log: [{ emit: "event", level: "query" }],
  });
  prisma.$on("query", (event) => queries.push({ query: event.query, params: event.params }));
  return { prisma, queries };
}
