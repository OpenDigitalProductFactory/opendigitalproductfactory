-- Gate identity is exclusive to governed initiative receipts and mandatory on
-- every such receipt. Ordinary legacy activities retain their null gate key.
-- @migration-safety: data-safe: gateKey and initiative_gate_receipt are introduced only by the preceding unreleased migration; no released writer can have produced a violating row.
ALTER TABLE "BacklogItemActivity"
  ADD CONSTRAINT "initiative_gate_activity_shape" CHECK (
    ("kind" = 'initiative_gate_receipt' AND "gateKey" IS NOT NULL)
    OR ("kind" <> 'initiative_gate_receipt' AND "gateKey" IS NULL)
  );
