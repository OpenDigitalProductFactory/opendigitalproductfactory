-- Autonomous coworker runtime Slice 1: remember latest TaskRun for scheduled work.
-- Additive and nullable by design; historical rows predate this model.
-- ToolExecution.taskRunId already exists from 20260424090000_add_task_trace_to_proposals_and_audit.

ALTER TABLE "ScheduledAgentTask" ADD COLUMN "taskRunId" TEXT;

CREATE INDEX "ScheduledAgentTask_taskRunId_idx" ON "ScheduledAgentTask"("taskRunId");
