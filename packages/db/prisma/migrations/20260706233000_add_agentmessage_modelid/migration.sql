-- Persist the model id alongside providerId on AgentMessage so per-turn
-- provider/model attribution survives reload (BI-1D0B5308). Today providerId
-- is stored but modelId is dropped, so historical assistant turns lose their
-- model attribution on reload and successful paid turns show none at all.
--
-- @migration-safety: data-safe: adds one nullable column with no default and
-- no constraint; existing rows get NULL modelId (rendered as no badge), so no
-- existing row can violate it and no backfill is required.

ALTER TABLE "AgentMessage" ADD COLUMN "modelId" TEXT;
