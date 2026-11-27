// Shared by the inspected host probe and the portal's transaction readback.
const { createHash } = require("node:crypto");

const PREVIEW_DATABASE_IDENTITY_SQL = `
  SELECT system_identifier::text AS "systemIdentifier", d.oid::text AS "databaseOid",
         d.datname::text AS "databaseName",
         extract(epoch from pg_catalog.pg_postmaster_start_time())::numeric::text AS "postmasterStartEpoch"
  FROM pg_catalog.pg_control_system() CROSS JOIN pg_catalog.pg_database AS d
  WHERE d.datname = pg_catalog.current_database()
`;

function previewLogicalRuntimeId(lease) {
  const fields = [
    "leaseId", "claimKey", "environmentKey", "ownerProvider", "ownerSessionId",
    "worktreePath", "branchName", "buildId", "url", "ports",
  ];
  return createHash("sha256").update(JSON.stringify(fields.map(key => [key, lease[key] ?? null]))).digest("hex");
}

module.exports = { PREVIEW_DATABASE_IDENTITY_SQL, previewLogicalRuntimeId };
