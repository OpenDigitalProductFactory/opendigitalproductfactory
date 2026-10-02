-- GPP Phase 2 PR-D (BI-69415B68): MAC, parameter-hash and lineage verdicts.
-- Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md (PR-D).
--
-- Forward-only and additive. Adding enum members touches no row, so this
-- applies the same against an empty table and a table full of PR-C verdicts.
-- IF NOT EXISTS keeps a re-run on a partially applied install harmless. No
-- statement here uses a new value, so ADD VALUE is safe inside the
-- migration's transaction (the pattern of 20260925150000_document_rendition_export_kinds).
-- No table or column is added: PR-C created GppPermit.paramHash, keyRef and
-- mac as nullable columns.
ALTER TYPE "GppPermitVerdict" ADD VALUE IF NOT EXISTS 'mac_invalid';
ALTER TYPE "GppPermitVerdict" ADD VALUE IF NOT EXISTS 'param_mismatch';
ALTER TYPE "GppPermitVerdict" ADD VALUE IF NOT EXISTS 'lineage_unsealed';
ALTER TYPE "GppPermitVerdict" ADD VALUE IF NOT EXISTS 'lineage_missing';
ALTER TYPE "GppPermitVerdict" ADD VALUE IF NOT EXISTS 'unsigned';
