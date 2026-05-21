-- Fix: Wiki principles duplicated on Windows due to backslash slugs
--
-- Root cause: seed-wiki-kernel.ts deriveSlug() stripped leading '/' but not '\'
-- so on Windows every principle was seeded twice:
--   once with slug '\principles\all-changes-land-via-pr'  (backslash, Windows)
--   once with slug  'principles/all-changes-land-via-pr'  (forward slash, correct)
--
-- This migration deletes the backslash-slug rows. The correct forward-slash rows
-- remain. The seed fix (deriveSlug now normalises \ → /) prevents recurrence.

DELETE FROM "WikiPage"
WHERE slug LIKE '\%'        -- slug starts with a backslash
   OR slug LIKE '%\%';     -- or contains a backslash anywhere
