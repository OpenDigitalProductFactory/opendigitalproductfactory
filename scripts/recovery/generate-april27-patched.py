#!/usr/bin/env python3
"""
Voice Slice 1 → Backlog Recovery Plan / Phase A3.1.

Generates a patched April 27 backlog restore SQL that NULLs dangling FK
columns against the current live DB and appends a recovery-note token to
BacklogItem.body / Epic.description for audit traceability.

Inputs:
  - D:/Backups/Backlog-20260427T035724Z.json (canonical April 27 backup)
  - Live DB queried via `docker exec dpf-postgres-1 psql`

Output:
  - D:/Backups/pre-recovery/april27-patched.sql

The output is loaded with:
  cat D:/Backups/pre-recovery/april27-patched.sql | docker exec -i dpf-postgres-1 psql -U dpf -d dpf

Idempotency: the script regenerates the SQL each run; safe to re-run.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path("D:/")
SOURCE_JSON = ROOT / "Backups" / "Backlog-20260427T035724Z.json"
OUTPUT_SQL = ROOT / "Backups" / "pre-recovery" / "april27-patched.sql"

# Per Phase A3.0 schema check + plan §A3.1.
FK_TABLES = {
    "digitalProductId":     '"DigitalProduct"',
    "taxonomyNodeId":       '"TaxonomyNode"',
    "submittedById":        '"User"',
    "agentId":              '"Agent"',
    "activeBuildId":        '"FeatureBuild"',
    "claimedById":          '"User"',
    "claimedByAgentId":     '"Agent"',
    "accountableEmployeeId": '"EmployeeProfile"',
    "duplicateOfId":        '"BacklogItem"',  # self-ref; will be NULLed if target not in this batch
}

# Epic-level FK targets.
EPIC_FK_TABLES = {
    "submittedById":         '"User"',
    "agentId":               '"Agent"',
    "accountableEmployeeId": '"EmployeeProfile"',
    "claimedById":           '"User"',
    "claimedByAgentId":      '"Agent"',
}

# EpicPortfolio FKs (epicId → Epic.epicId is checked against this run's restored epics)
EP_PORTFOLIO_FK_TABLES = {
    "portfolioId": '"Portfolio"',
}


def docker_psql(sql: str) -> str:
    """Run a psql query inside the live postgres container and return raw output."""
    result = subprocess.run(
        ["docker", "exec", "-i", "dpf-postgres-1", "psql", "-U", "dpf", "-d", "dpf", "-tA", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    return result.stdout


def fetch_id_set(table: str) -> set[str]:
    """Fetch the set of IDs in a target FK table."""
    out = docker_psql(f'SELECT id FROM {table};')
    return {line.strip() for line in out.splitlines() if line.strip()}


def sql_str(s: Any) -> str:
    """SQL string-literal encode."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def sql_int(n: Any) -> str:
    return "NULL" if n is None else str(int(n))


def sql_ts(ts: Any) -> str:
    """ISO 8601 timestamp to SQL literal."""
    if ts is None:
        return "NULL"
    s = str(ts).replace("Z", "").replace("T", " ")
    return f"'{s}'"


def patch_fks(row: dict, fk_map: dict[str, str], existing_ids: dict[str, set[str]],
              note_target: str = "body") -> dict:
    """Patch a row in-place. For each FK col in fk_map, if value is not in existing_ids,
    NULL it out and append a recovery-note to row[note_target]."""
    nulled = []
    for col, table_name in fk_map.items():
        val = row.get(col)
        if val is not None and val not in existing_ids[table_name]:
            nulled.append((col, val))
            row[col] = None
    if nulled:
        old_body = row.get(note_target) or ""
        notes = " ".join(f"[recovery-note:fk-nulled:{c}={v}]" for c, v in nulled)
        row[note_target] = f"{old_body}\n\n{notes}" if old_body else notes
    return row


def emit_epic_insert(e: dict) -> str:
    cols = [
        "id", "epicId", "title", "description", "status",
        "createdAt", "updatedAt", "submittedById", "agentId", "completedAt",
        "accountableEmployeeId", "claimedById", "claimedByAgentId", "claimedAt", "claimStatus",
        "upstreamIssueNumber", "upstreamIssueUrl", "upstreamSyncedAt",
    ]
    encoders = {
        "createdAt": sql_ts, "updatedAt": sql_ts, "completedAt": sql_ts,
        "claimedAt": sql_ts, "upstreamSyncedAt": sql_ts,
        "upstreamIssueNumber": sql_int,
    }
    vals = ", ".join(encoders.get(c, sql_str)(e.get(c)) for c in cols)
    quoted_cols = ", ".join(f'"{c}"' for c in cols)
    return f'INSERT INTO public."Epic" ({quoted_cols}) VALUES ({vals});'


def emit_backlog_item_insert(b: dict) -> str:
    cols = [
        "id", "itemId", "title", "status", "type", "body", "createdAt", "updatedAt",
        "priority", "digitalProductId", "taxonomyNodeId", "epicId", "source",
        "occurrenceCount", "lastSeenAt", "agentId", "submittedById", "completedAt",
        "accountableEmployeeId", "claimedById", "claimedByAgentId", "claimedAt", "claimStatus",
        "upstreamIssueNumber", "upstreamIssueUrl", "upstreamSyncedAt",
        "abandonReason", "activeBuildId", "duplicateOfId", "effortSize",
        "proposedOutcome", "resolution", "stalenessDetectedAt", "triageOutcome",
    ]
    encoders = {
        "createdAt": sql_ts, "updatedAt": sql_ts, "completedAt": sql_ts,
        "lastSeenAt": sql_ts, "claimedAt": sql_ts, "upstreamSyncedAt": sql_ts,
        "stalenessDetectedAt": sql_ts,
        "priority": sql_int, "occurrenceCount": sql_int, "upstreamIssueNumber": sql_int,
    }
    vals = ", ".join(encoders.get(c, sql_str)(b.get(c)) for c in cols)
    quoted_cols = ", ".join(f'"{c}"' for c in cols)
    return f'INSERT INTO public."BacklogItem" ({quoted_cols}) VALUES ({vals});'


def emit_epic_portfolio_insert(ep: dict) -> str:
    # EpicPortfolio schema is (epicId, portfolioId) only — no id, no addedAt.
    cols = ["epicId", "portfolioId"]
    vals = ", ".join(sql_str(ep.get(c)) for c in cols)
    quoted_cols = ", ".join(f'"{c}"' for c in cols)
    return f'INSERT INTO public."EpicPortfolio" ({quoted_cols}) VALUES ({vals});'


def main() -> int:
    if not SOURCE_JSON.exists():
        print(f"ERROR: source JSON not found at {SOURCE_JSON}", file=sys.stderr)
        return 1

    with SOURCE_JSON.open(encoding="utf-8") as fh:
        backup = json.load(fh)

    epics = backup.get("Epic") or []
    items = backup.get("BacklogItem") or []
    eps = backup.get("EpicPortfolio") or []

    print(f"[recovery] source counts: Epic={len(epics)} BacklogItem={len(items)} EpicPortfolio={len(eps)}", file=sys.stderr)

    # Fetch live ID sets for each FK target table.
    all_tables = set(FK_TABLES.values()) | set(EPIC_FK_TABLES.values()) | set(EP_PORTFOLIO_FK_TABLES.values())
    existing_ids: dict[str, set[str]] = {}
    for t in all_tables:
        existing_ids[t] = fetch_id_set(t)
        print(f"[recovery] live {t} has {len(existing_ids[t])} IDs", file=sys.stderr)

    # For BacklogItem.duplicateOfId, the "existing IDs" are the rows being restored in THIS run.
    # Collect them from the source JSON (the cuid `id` column, not `itemId`).
    restore_backlog_item_ids = {it.get("id") for it in items if it.get("id")}
    existing_ids['"BacklogItem"'] = restore_backlog_item_ids

    # IMPORTANT: EpicPortfolio.epicId references Epic.id (cuid), NOT Epic.epicId (semantic).
    # This is the OPPOSITE of BacklogItem.epicId, which DOES use the semantic Epic.epicId.
    # Per live schema (\d "EpicPortfolio"):
    #   "EpicPortfolio_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"(id)
    # So the existing-set check uses Epic.id (cuid) of the rows being restored in THIS run.
    restore_epic_cuids = {e.get("id") for e in epics if e.get("id")}

    # Counters.
    n_items_patched = 0
    n_epics_patched = 0
    n_eps_patched = 0

    # Patch Epic rows (rarely have dangling FKs but check).
    for e in epics:
        before_desc = e.get("description")
        patch_fks(e, EPIC_FK_TABLES, existing_ids, note_target="description")
        if e.get("description") != before_desc:
            n_epics_patched += 1

    # Patch BacklogItem rows.
    for b in items:
        before_body = b.get("body")
        patch_fks(b, FK_TABLES, existing_ids, note_target="body")
        if b.get("body") != before_body:
            n_items_patched += 1

    # Patch EpicPortfolio rows. The schema is (epicId, portfolioId) only — no `id` column.
    # Both are NOT NULL. Both FKs reference cuids in their target tables (Epic.id +
    # Portfolio.id). We can't NULL them — we drop the row instead if either FK doesn't resolve.
    eps_kept: list[dict] = []
    for ep in eps:
        epic_ok = ep.get("epicId") in restore_epic_cuids
        portfolio_ok = ep.get("portfolioId") in existing_ids['"Portfolio"']
        if epic_ok and portfolio_ok:
            eps_kept.append(ep)
        else:
            n_eps_patched += 1
    eps_dropped = len(eps) - len(eps_kept)

    print(f"[recovery] patched {n_items_patched} BacklogItem / {n_epics_patched} Epic / {n_eps_patched} EpicPortfolio rows", file=sys.stderr)
    if eps_dropped:
        print(f"[recovery] dropped {eps_dropped} EpicPortfolio rows with NULL epicId/portfolioId (NOT NULL columns)", file=sys.stderr)

    # Emit SQL.
    lines: list[str] = [
        "-- Voice Slice 1 → Backlog Recovery Plan / Phase A3.1.",
        f"-- Generated from {SOURCE_JSON.name} via scripts/recovery/generate-april27-patched.py",
        f"-- Rows: Epic={len(epics)} BacklogItem={len(items)} EpicPortfolio={len(eps_kept)} (of {len(eps)} in source)",
        f"-- FK-nulled: BacklogItem={n_items_patched} / Epic={n_epics_patched} / EpicPortfolio={n_eps_patched}",
        "",
        "BEGIN;",
        "",
        "-- Epics first (FK target for BacklogItem.epicId).",
    ]
    for e in epics:
        lines.append(emit_epic_insert(e))

    lines.append("")
    lines.append("-- BacklogItems.")
    for b in items:
        lines.append(emit_backlog_item_insert(b))

    lines.append("")
    lines.append("-- EpicPortfolio (only rows where both FKs resolved).")
    for ep in eps_kept:
        lines.append(emit_epic_portfolio_insert(ep))

    lines.append("")
    lines.append("COMMIT;")
    lines.append("")

    OUTPUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_SQL.write_text("\n".join(lines), encoding="utf-8")
    size_kb = OUTPUT_SQL.stat().st_size // 1024
    print(f"[recovery] wrote {OUTPUT_SQL} ({size_kb} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
