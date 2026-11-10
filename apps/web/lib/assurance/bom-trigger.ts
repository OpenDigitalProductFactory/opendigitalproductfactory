import { jobs, type AssuranceBomGenerateEvent } from "@/lib/jobs";

export async function queueBuildBomGeneration(input: { buildId: string; requestedByUserId: string }) {
  const event: AssuranceBomGenerateEvent = {
    name: "assurance/bom.generate",
    data: input,
  };

  return jobs.send(event);
}
