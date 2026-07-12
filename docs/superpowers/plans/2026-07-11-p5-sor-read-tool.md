# P5 — System-of-record → coworker read tool

- **BI:** BI-97BF837B · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — a read-only tool over existing models via the established pack pattern.

## Problem (from the audit)

Coworkers could `list_customer_accounts` / `list_opportunities` / `list_quotes`, but the operational records those accounts generate — **invoices and payments** — had no read tool at all (~3 of ~19 operational models covered). A coworker asked "did account X pay their last invoice?" had to guess or tell the operator to go look. The page-data providers bake a static snapshot into the prompt; there was no way to fetch the live record on demand.

## Approach — a read-only SoR tool via a new pack + an extensible reader registry

Substrate-verify-first: use the established tool-pack pattern (register in `pack-registry.ts` only — `mcp-tools.ts` untouched). Read-only, and **JIT** (BI-223E55DA discipline): every read is live from Prisma, never a memorized snapshot.

1. `apps/web/lib/mcp/packs/sor-read-pack.ts` (new): one tool `read_operational_record` (`entityType` + optional `ref`/`id`/`limit`) backed by a `SOR_READERS` registry — the **convention**: adding a model is one entry. Seeded with `invoice` and `payment` (both tied to a customer account, coherent with the CRM read grant). Bounded rows, key fields only, Decimal/Date coerced to JSON-safe values.
2. Register the pack (`pack-registry.ts`), gate it behind `crm_read` (the tool's `TOOL_TO_GRANTS` entry + pack grant), `requiredCapability: "view_customer"`, `sideEffect: false`. The CRM/finance coworkers that already hold `crm_read` reach it automatically — no seed change.

## Verification
- Unit (`sor-read-pack.test.ts`, 5): tool shape (read-only, view_customer); grant gating (crm_read/crm_write reach it, others don't); provenance-free description; the enum stays in sync with the reader registry; unknown entityType returns a clean error, no throw. `tool-registry.test.ts` (composes the pack without duplicate-name collision). tsc clean. mcp-tool-pack ratchet green (tool lives in a pack, not inline).

## Non-goals (honest follow-ups)
- The **act** (write) half and the remaining ~15 operational models — the reader registry is the extension point; each model is one entry.
- A per-route `route-context` generator — the default provider already guarantees page perception; this BI adds the live *read* the pre-baked providers stand in for.
