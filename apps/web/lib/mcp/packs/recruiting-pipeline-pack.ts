// Recruiting pipeline lens — BI-E64D11AE (Absorb surface).
//
// get_recruiting_pipeline: the unified recruiting funnel — native Applications
// plus Greenhouse-sourced staged rows, deduped by crosswalk — so the HR
// coworker (and any operator via the coworker) sees ONE pipeline across native
// and integrated work without leaving to two systems. Read-only; the read model
// is shared with the pipeline surface so the tool and any future UI never drift.

import { prisma } from "@dpf/db";
import {
  getRecruitingPipeline,
  type RecruitingPipelineClient,
} from "@/lib/recruiting/pipeline-read-model";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "get_recruiting_pipeline",
    description:
      "Show the unified recruiting pipeline — native applications plus Greenhouse-sourced candidates not yet promoted — as one funnel, deduped so a candidate imported from Greenhouse and its native row appear once. Optionally narrow to a single requisition. Read-only; no candidate PII beyond display name, status, and stage.",
    inputSchema: {
      type: "object",
      properties: {
        requisitionId: {
          type: "string",
          description: "Only applications for this native requisition id.",
        },
      },
    },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
];

async function getRecruitingPipelineHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const requisitionId =
    typeof params["requisitionId"] === "string" ? params["requisitionId"] : undefined;

  // Prisma's generated client is structurally wider than the narrow read-model
  // port; bridge it at this single call site.
  const db = prisma as unknown as RecruitingPipelineClient;
  const pipeline = await getRecruitingPipeline(db, { requisitionId });

  return {
    success: true,
    message: `Recruiting pipeline: ${pipeline.counts.total} in the funnel (${pipeline.counts.native} native, ${pipeline.counts.greenhouse} from Greenhouse not yet promoted).`,
    data: { ...pipeline },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  get_recruiting_pipeline: (params) => getRecruitingPipelineHandler(params),
};

export const recruitingPipelinePack: ToolPack = {
  packId: "recruiting-pipeline",
  definitions,
  handlers,
  grants: {
    get_recruiting_pipeline: ["consumer_read", "registry_read"],
  },
};
