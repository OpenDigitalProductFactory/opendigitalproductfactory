-- BI-4865EB4D (S5 of BI-815D40C6): widen DocumentRenditionKind with the two
-- export formats a document version can be exported to, docx and odt. (An
-- exported PDF reuses the existing pdf member.)
--
-- Forward-only and additive. Adding enum members touches no row, so this
-- applies the same against an empty table and a table full of pdf and
-- plain_text renditions. IF NOT EXISTS keeps a re-run harmless.
ALTER TYPE "DocumentRenditionKind" ADD VALUE IF NOT EXISTS 'docx';
ALTER TYPE "DocumentRenditionKind" ADD VALUE IF NOT EXISTS 'odt';
