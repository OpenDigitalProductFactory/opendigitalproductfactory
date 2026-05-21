-- Corrective migration: the prior migration (20260521120000) used
-- LIKE '\%' which is a no-op in PostgreSQL (backslash is the LIKE
-- escape character, so '\%' matches a literal %, not a backslash).
-- This migration uses position() which unambiguously matches any slug
-- containing a literal backslash character.
-- Idempotent: already-clean installs will match 0 rows.

DELETE FROM "WikiPage"
WHERE position('\' in slug) > 0;
