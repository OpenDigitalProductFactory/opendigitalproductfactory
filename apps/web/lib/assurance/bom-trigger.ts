import { inngest, type AssuranceBomGenerateEvent } from "@/lib/queue/inngest-client";

export async function queueBuildBomGeneration(input: { buildId: string; requestedByUserId: string }) {
  const event: AssuranceBomGenerateEvent = {
    name: "assurance/bom.generate",
    data: input,
  };

  return inngest.send(event);
}
