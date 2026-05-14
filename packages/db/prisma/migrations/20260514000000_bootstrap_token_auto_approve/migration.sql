-- Add BootstrapToken.autoApprove per spec § Approval policy.
--
-- The Phase 0 schema in 20260512000000_add_edge_node_phase0 left
-- auto-approval implicit: the /api/v1/edge/enroll route hardcoded
-- `autoApprove: false`, so every paste-provisioned token landed
-- the new EdgeNode in trustState=pending. That's the right default
-- for remote-host enrollment (an operator must intend to admit the
-- node), but it forces a redundant Approve click for the single-
-- host install where the operator running install-dpf.sh has
-- already proven host access.
--
-- This migration adds a column the issuer can set when the token
-- represents an already-authorized intent (installer for local
-- host, or operator pre-approving bulk enrollment). The enroll
-- route reads the column and skips the pending state when set.
--
-- Threat model: an attacker who can flip this column either (a)
-- has DB write access (in which case they could create their own
-- trusted EdgeNode anyway) or (b) issued the token themselves
-- (operator action or installer; both require host access that
-- defeats most lighter controls). The column is not a security
-- boundary; it's an automation toggle for paths where the
-- operator-approval click adds friction without adding signal.

ALTER TABLE "BootstrapToken"
  ADD COLUMN "autoApprove" BOOLEAN NOT NULL DEFAULT false;
