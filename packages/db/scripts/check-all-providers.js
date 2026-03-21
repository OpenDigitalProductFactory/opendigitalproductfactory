// Quick check — uses the seed-helpers pattern for DB access
const { execSync } = require("child_process");
const path = require("path");

// Use prisma db execute to query
const sql = `SELECT "providerId", "name", "status", "authMethod" FROM "ModelProvider" ORDER BY "providerId";`;
const sqlFile = path.join(__dirname, "_temp_query.sql");
require("fs").writeFileSync(sqlFile, sql);

try {
  const result = execSync(
    `npx prisma db execute --file ${sqlFile}`,
    { cwd: path.join(__dirname, ".."), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  console.log(result);
} catch (e) {
  // prisma db execute doesn't return SELECT results. Use a different approach.
  console.log("prisma db execute doesn't support SELECT. Trying alternative...");
}
require("fs").unlinkSync(sqlFile);
