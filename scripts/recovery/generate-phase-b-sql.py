#!/usr/bin/env python3
"""
Phase B SQL emitter — converts cluster definitions into INSERT/UPDATE statements
loadable against the live `dpf-postgres-1` database.

Outputs:
  D:/Backups/pre-recovery/phase-b.sql      — runnable patched SQL
  D:/Backups/pre-recovery/phase-b.json     — proposal report (for audit doc)

Idempotency: the script regenerates the SQL each run. Safe to re-run during
plan review. Actual DB load is a separate `psql -f` invocation.
"""
from __future__ import annotations

import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("D:/")
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
clusters_mod = import_module("phase-b-clusters")
CLUSTERS = clusters_mod.CLUSTERS
APRIL27_STALE_DEFER = clusters_mod.APRIL27_STALE_DEFER

OUTPUT_SQL = ROOT / "Backups" / "pre-recovery" / "phase-b.sql"
OUTPUT_JSON = ROOT / "Backups" / "pre-recovery" / "phase-b.json"

NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
NOW_SQL = f"'{NOW.replace('Z','').replace('T',' ')}'"


def cuid() -> str:
    """Cuid-like id: 25-char lowercased alphanumeric, prefix 'c'."""
    return "c" + secrets.token_hex(12)


def sql_str(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def gen_item_id() -> str:
    """Generate a new BI-* style id for items that lack a pre-allocated one.

    Uses the same shape as `BI-<8 hex>` to match existing convention.
    """
    return "BI-" + secrets.token_hex(4).upper()


def build_body(item: dict, epic_id: str) -> str:
    sources = []
    if item.get("source"):
        sources.append(f"source={item['source']}")
    if item.get("evidence_prs"):
        sources.append("pr-" + ",pr-".join(str(p) for p in item["evidence_prs"]))
    if item.get("evidence_spec"):
        sources.append(f"spec:{item['evidence_spec']}")
    if item.get("evidence_plan"):
        sources.append(f"plan:{item['evidence_plan']}")
    if item.get("evidence_worktree"):
        sources.append(f"worktree:{item['evidence_worktree']}")

    provenance = " ".join(f"[recovery-note:provenance:phase-b:2026-05-17:{s}]" for s in sources)

    base = item.get("body") or item["title"]
    note = f"[recovery-note:epic={epic_id}]"
    parts = [base, note]
    if provenance:
        parts.append(provenance)
    return "\n\n".join(parts)


def epic_insert(epic: dict, eid: str) -> str:
    """Emit Epic INSERT. Caller passes the cuid so it can use it as FK target
    for the epic's BacklogItem rows (BacklogItem.epicId references Epic.id,
    NOT Epic.epicId — per project_backlog_epic_fk_pitfall memory note).
    Idempotent: ON CONFLICT on epicId DO NOTHING."""
    return (
        'INSERT INTO public."Epic" '
        '("id", "epicId", "title", "description", "status", "createdAt", "updatedAt") VALUES ('
        f'{sql_str(eid)}, {sql_str(epic["epicId"])}, {sql_str(epic["title"])}, '
        f'{sql_str(epic["description"])}, {sql_str(epic["status"])}, '
        f'{NOW_SQL}, {NOW_SQL}) '
        'ON CONFLICT ("epicId") DO NOTHING;'
    )


def epic_update_status_only(epic_id: str, status: str, note: str) -> str:
    """For surviving April 27 epics that we mark stale."""
    desc_append = f"\n\n[recovery-note:phase-b:2026-05-17:{note}]"
    return (
        'UPDATE public."Epic" SET '
        f'status = {sql_str(status)}, '
        f'description = COALESCE(description, \'\') || {sql_str(desc_append)}, '
        f'"updatedAt" = {NOW_SQL} '
        f'WHERE "epicId" = {sql_str(epic_id)};'
    )


def item_insert(item: dict, epic_semantic_id: str, epic_cuid: str) -> str:
    """Emit BacklogItem INSERT. epicId column points at Epic.id (cuid), NOT
    Epic.epicId (semantic) — Prisma FK constraint enforces this."""
    iid = cuid()
    bi_id = item.get("itemId") or gen_item_id()
    body = build_body(item, epic_semantic_id)
    status = item.get("status", "open")
    type_ = item.get("type", "product")
    priority = item.get("priority", 3)
    completed_at = NOW_SQL if status == "done" else "NULL"

    # ON CONFLICT ("itemId") DO NOTHING — idempotent. If a pre-allocated BI-*
    # already exists (e.g., survived from April-27 baseline), the Phase B
    # insert silently skips so existing data is not clobbered.
    return (
        'INSERT INTO public."BacklogItem" '
        '("id", "itemId", "title", "status", "type", "body", "createdAt", "updatedAt", '
        '"priority", "epicId", "completedAt", "source", "occurrenceCount") VALUES ('
        f'{sql_str(iid)}, {sql_str(bi_id)}, {sql_str(item["title"])}, '
        f'{sql_str(status)}, {sql_str(type_)}, {sql_str(body)}, '
        f'{NOW_SQL}, {NOW_SQL}, '
        f'{priority}, {sql_str(epic_cuid)}, {completed_at}, '
        f'{sql_str(item.get("source", "phase-b-recovery"))}, 1) '
        'ON CONFLICT ("itemId") DO NOTHING;'
    )


def main() -> int:
    lines: list[str] = [
        "-- Phase B backlog recovery — 2026-05-17",
        "-- Generated by scripts/recovery/generate-phase-b-sql.py",
        f"-- Generated at {NOW}",
        f"-- Clusters: {len(CLUSTERS)}",
        "",
        "BEGIN;",
        "",
        "-- ── Stale April-27 epics → defer ─────────────────────────────────",
    ]
    for eid in APRIL27_STALE_DEFER:
        lines.append(
            epic_update_status_only(
                eid,
                "deferred",
                "stale-since-baseline-no-post-apr27-pr-activity",
            )
        )

    lines += ["", "-- ── New epics + items ──────────────────────────────────────────"]

    item_count = 0
    epic_count = 0
    by_status_count: dict[str, int] = {}
    pre_allocated_count = 0
    proposal: list[dict] = []

    for cluster in CLUSTERS:
        if cluster.get("existing"):
            # Reserved for future use; current schema doesn't have any.
            continue

        epic_cuid = cuid()  # cuid() for this epic, used by its items as FK target
        lines.append(f'-- Epic: {cluster["epicId"]} — {cluster["title"]}')
        lines.append(epic_insert(cluster, epic_cuid))
        epic_count += 1

        cluster_proposal_items = []
        for item in cluster["items"]:
            lines.append(item_insert(item, cluster["epicId"], epic_cuid))
            item_count += 1
            st = item.get("status", "open")
            by_status_count[st] = by_status_count.get(st, 0) + 1
            if item.get("itemId"):
                pre_allocated_count += 1
            cluster_proposal_items.append(
                {
                    "itemId": item.get("itemId") or "(new)",
                    "title": item["title"],
                    "status": st,
                    "source": item.get("source", ""),
                    "evidence_prs": item.get("evidence_prs", []),
                }
            )

        proposal.append(
            {
                "epicId": cluster["epicId"],
                "title": cluster["title"],
                "status": cluster["status"],
                "item_count": len(cluster["items"]),
                "items": cluster_proposal_items,
            }
        )

        lines.append("")

    lines += [
        "",
        "COMMIT;",
        "",
        f"-- SUMMARY:",
        f"--   Epics created: {epic_count}",
        f"--   Items created: {item_count}",
        f"--   Pre-allocated BI-* preserved: {pre_allocated_count}",
        f"--   April-27 epics deferred: {len(APRIL27_STALE_DEFER)}",
    ]
    for st, c in sorted(by_status_count.items()):
        lines.append(f"--   By status: {st} = {c}")

    OUTPUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_SQL.write_text("\n".join(lines), encoding="utf-8")

    summary = {
        "generated_at": NOW,
        "epics_created": epic_count,
        "items_created": item_count,
        "pre_allocated_preserved": pre_allocated_count,
        "april27_deferred": APRIL27_STALE_DEFER,
        "by_status_count": by_status_count,
        "clusters": proposal,
    }
    OUTPUT_JSON.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"[phase-b] wrote SQL: {OUTPUT_SQL} ({OUTPUT_SQL.stat().st_size // 1024} KB)", file=sys.stderr)
    print(f"[phase-b] wrote JSON: {OUTPUT_JSON}", file=sys.stderr)
    print(f"[phase-b] {epic_count} epics, {item_count} items, {pre_allocated_count} pre-allocated BI-* preserved", file=sys.stderr)
    print(f"[phase-b] status distribution: {by_status_count}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
