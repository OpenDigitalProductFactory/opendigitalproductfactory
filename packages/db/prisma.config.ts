import { defineConfig } from "prisma/config";
import { loadDbEnv } from "./src/load-env";

loadDbEnv();

export default defineConfig({
  // Multi-file schema folder (Simplify & Strengthen B5 Seam C, BI-134DD02F):
  // every *.prisma file under prisma/schema is loaded recursively.
  schema: "prisma/schema",
  // Pin the migration chain to its historical location — the schema moved into
  // a folder; the migrations directory did NOT move.
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
