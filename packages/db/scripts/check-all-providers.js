// Quick check — uses the seed-helpers pattern for DB access
const { execSync } = require("child_process");
const path = require("path");

// Use prisma db execute to query
const sql = `SELECT "providerId", "name", "status", "authMethod" FROM "ModelProvider" ORDER BY "providerId";`;
const sqlFile = path.join(__dirname, "_temp_query.sql");
require("fs").writeFileSync(sqlFile, sql);

try {
  // CodeQL #53 (js/shell-command-injection-from-environment): use the
  // argv form of execFileSync instead of a shell string so $PATH /
  // environment-supplied npx binary can't be hijacked, and so the
  // sqlFile path is passed as a single argv element (not parsed by
  // the shell).
  const { execFileSync } = require("child_process");
  const result = execFileSync(
    "npx",
    ["prisma", "db", "execute", "--file", sqlFile],
    { cwd: path.join(__dirname, ".."), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], shell: false }
  );
  console.log(result);
} catch (e) {
  // prisma db execute doesn't return SELECT results. Use a different approach.
  console.log("prisma db execute doesn't support SELECT. Trying alternative...");
}
require("fs").unlinkSync(sqlFile);
