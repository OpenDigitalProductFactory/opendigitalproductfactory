-- BI-0ACD9AB2 §5.3 / §14 dial-up: the autonomous escalation-responder sweep
-- pre-computes a WWMD recommendation for each held escalation and stores it here,
-- so the /ops attention lens shows the kernel's proposed disposition without an
-- operator click. Advisory only — the human still decides; no autonomous build
-- disposition. Additive, nullable; existing rows are unaffected. responderDecidedAt
-- doubles as the "already consulted" marker (NULL = needs a sweep).
ALTER TABLE "PlatformIssueReport" ADD COLUMN "responderDecision" JSONB;
ALTER TABLE "PlatformIssueReport" ADD COLUMN "responderDecidedAt" TIMESTAMP(3);
