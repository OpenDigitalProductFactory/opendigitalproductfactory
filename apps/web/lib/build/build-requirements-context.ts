import { isRecord } from "@/lib/shared/coerce";
import {
  buildRequirementsPacket,
  formatBuildRequirementsPacketForPrompt,
} from "@/lib/coworker-service-catalog/build-requirements";

type BuildRequirementsContext = {
  title: string;
  brief?: unknown;
  designDoc?: unknown;
  buildPlan?: unknown;
  businessContext?: string | null;
  scoutFindings?: string | null;
  plan?: Record<string, unknown> | null;
};

export function formatBuildRequirementsContextSection(ctx: BuildRequirementsContext): string {
  return formatBuildRequirementsPacketForPrompt(
    buildRequirementsPacket({
      title: ctx.title,
      brief: isRecord(ctx.brief) ? ctx.brief : null,
      designDoc: isRecord(ctx.designDoc) ? ctx.designDoc : null,
      buildPlan: isRecord(ctx.buildPlan) ? ctx.buildPlan : null,
      businessContext: ctx.businessContext,
      scoutFindings: ctx.scoutFindings,
      runningSpec: ctx.plan,
    }),
  );
}
