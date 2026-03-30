// Temporary script: restore epics + backlog items from CSV backups
// Usage: node scripts/restore-epics.js | docker exec -i dpf-postgres-1 psql -U dpf -d dpf

const fs = require("fs");
const path = require("path");

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inQuotes = !inQuotes;
    } else if (line[i] === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += line[i];
    }
  }
  result.push(current);
  return result;
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
  const lines = content.trim().split("\n");
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i] || ""));
    return obj;
  });
}

function escSQL(str) {
  return str.replace(/'/g, "''");
}

// Normalize statuses per CLAUDE.md rules
function normalizeEpicStatus(s) {
  const map = { backlog: "open", complete: "done", in_progress: "in-progress" };
  return map[s] || s;
}
function normalizeItemStatus(s) {
  const map = { backlog: "open", complete: "done", in_progress: "in-progress" };
  return map[s] || s;
}

const backupDir = "H:\\backups";
const epics = parseCSV(path.join(backupDir, "epics-20260329.csv"));
const items = parseCSV(path.join(backupDir, "backlog-items-20260329.csv"));

// Build mapping: internal epic ID → epic string ID
// Group items by their epicId (internal) and infer the epic string from item naming
const internalToString = {};
for (const item of items) {
  if (!item.epicId) continue;
  // Already mapped? skip
  if (internalToString[item.epicId]) continue;

  const itemId = item.itemId;
  // Try to match item ID prefix to epic string
  if (itemId.startsWith("BI-DMR-")) internalToString[item.epicId] = "EP-DMR-001";
  else if (itemId.startsWith("BI-CLOUD-")) internalToString[item.epicId] = "EP-CLOUD-DEPLOY-001";
  else if (itemId.startsWith("BI-TGOV-")) internalToString[item.epicId] = "EP-TASK-GOV-001";
  else if (itemId.startsWith("BI-COLL-")) internalToString[item.epicId] = "EP-COLL-001";
  else if (itemId.startsWith("EP-SELF-DEV-005-")) internalToString[item.epicId] = "EP-SELF-DEV-005";
  else if (itemId.startsWith("BI-PROD-BUILD-")) internalToString[item.epicId] = "EP-PROD-BUILD-001";
  else if (itemId.startsWith("BI-DEVC-")) internalToString[item.epicId] = "EP-DEVCONTAINER-001";
  else if (itemId.startsWith("BI-SPEC-")) internalToString[item.epicId] = "EP-SPEC-001";
  else if (itemId.startsWith("BI-LLM-")) internalToString[item.epicId] = "EP-LLM-LIVE-001";
  else if (itemId.startsWith("BI-DEPLOY-")) internalToString[item.epicId] = "EP-DEPLOY-001";
  else if (itemId.startsWith("BI-EXEC-")) internalToString[item.epicId] = "EP-AGENT-EXEC-001";
  else if (itemId.startsWith("BI-REST-")) internalToString[item.epicId] = "EP-REST-API-001";
  else if (itemId.startsWith("BI-MOB-0") && parseInt(itemId.split("-")[2]) <= 9) internalToString[item.epicId] = "EP-MOBILE-FOUND-001";
  else if (itemId.startsWith("BI-MOB-01") || itemId.startsWith("BI-MOB-02") && parseInt(itemId.replace("BI-MOB-0","")) <= 21) internalToString[item.epicId] = "EP-MOBILE-FEAT-001";
  else if (itemId.startsWith("BI-MOB-02") && parseInt(itemId.replace("BI-MOB-0","")) >= 22) internalToString[item.epicId] = "EP-MOBILE-DYN-001";
  else if (itemId.startsWith("BI-PROD-00") && parseInt(itemId.split("-")[2]) >= 4 && parseInt(itemId.split("-")[2]) <= 8) internalToString[item.epicId] = "EP-UI-THEME-001";
  else if (itemId.startsWith("BI-PROD-00") && parseInt(itemId.split("-")[2]) >= 9) internalToString[item.epicId] = "EP-UI-A11Y-001";
  else if (itemId.startsWith("BI-PROD-01")) internalToString[item.epicId] = "EP-UI-A11Y-001";
  // Bug items (BI-08CF*, BI-0D2D*, etc.) → QA epic
  else if (/^BI-[0-9A-F]{4,}/.test(itemId)) internalToString[item.epicId] = "EP-f469fa1b-0cb6-47b6-8d91-dbf6f0139e77";
}

// Build reverse mapping: epic string → internal ID
const stringToInternal = {};
for (const [internal, epicStr] of Object.entries(internalToString)) {
  stringToInternal[epicStr] = internal;
}

// Collect all unique epicIds referenced by backlog items
const allReferencedEpicIds = new Set();
for (const item of items) {
  if (item.epicId) allReferencedEpicIds.add(item.epicId);
}

// Track which internal IDs are actually used in epic INSERTs
const insertedInternalIds = new Set();

// Generate SQL
const sql = [];
sql.push("BEGIN;");
sql.push("");

// Insert epics from CSV
sql.push("-- ══ Epics (from CSV) ══");
for (const epic of epics) {
  const epicId = epic.epicId;
  const title = escSQL(epic.title);
  const status = normalizeEpicStatus(epic.status);
  const internalId = stringToInternal[epicId] || null;

  if (internalId) {
    insertedInternalIds.add(internalId);
    sql.push(
      `INSERT INTO "Epic" (id, "epicId", title, status, "createdAt", "updatedAt") VALUES ('${internalId}', '${escSQL(epicId)}', '${title}', '${status}', NOW(), NOW()) ON CONFLICT ("epicId") DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, id = '${internalId}', "updatedAt" = NOW();`
    );
  } else {
    sql.push(
      `INSERT INTO "Epic" (id, "epicId", title, status, "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, '${escSQL(epicId)}', '${title}', '${status}', NOW(), NOW()) ON CONFLICT ("epicId") DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status, "updatedAt" = NOW();`
    );
  }
}

// Insert fallback epics for any referenced epicIds not actually inserted
sql.push("");
sql.push("-- ══ Fallback Epics (referenced by items but not inserted above) ══");
for (const internalId of allReferencedEpicIds) {
  if (!insertedInternalIds.has(internalId)) {
    sql.push(
      `INSERT INTO "Epic" (id, "epicId", title, status, "createdAt", "updatedAt") VALUES ('${escSQL(internalId)}', 'UNMAPPED-${escSQL(internalId)}', 'Unmapped Epic (restore placeholder)', 'open', NOW(), NOW()) ON CONFLICT ON CONSTRAINT "Epic_pkey" DO NOTHING;`
    );
  }
}

sql.push("");
sql.push("-- ══ Backlog Items ══");

for (const item of items) {
  const itemId = escSQL(item.itemId);
  const title = escSQL(item.title);
  const type = item.type;
  const status = normalizeItemStatus(item.status);
  const epicId = item.epicId || null;

  // For items with epicId, look up the epic's internal ID
  // The epicId in the CSV IS the internal ID, so use it directly
  const epicRef = epicId ? `'${escSQL(epicId)}'` : "NULL";

  sql.push(
    `INSERT INTO "BacklogItem" (id, "itemId", title, type, status, "epicId", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, '${itemId}', '${title}', '${type}', '${status}', ${epicRef}, NOW(), NOW()) ON CONFLICT ("itemId") DO UPDATE SET title = EXCLUDED.title, type = EXCLUDED.type, status = EXCLUDED.status, "epicId" = EXCLUDED."epicId", "updatedAt" = NOW();`
  );
}

sql.push("");
sql.push("COMMIT;");

process.stdout.write(sql.join("\n") + "\n");
