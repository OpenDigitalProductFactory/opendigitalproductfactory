-- Add a first-class epic priority so MCP generic epic management can rank
-- roadmap-level epics without overloading backlog item priority.
ALTER TABLE "Epic" ADD COLUMN "priority" INTEGER;
