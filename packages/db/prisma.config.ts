import { defineConfig } from "prisma/config";
import { loadDbEnv } from "./src/load-env";

loadDbEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrate: {
    schema: "prisma/schema.prisma",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
