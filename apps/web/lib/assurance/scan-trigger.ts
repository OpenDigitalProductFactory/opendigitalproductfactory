import { inngest, type AssuranceScanRunEvent } from "@/lib/queue/inngest-client";

export async function queueBuildAssuranceScan(input: { buildId: string; requestedByUserId: string }) {
  const event: AssuranceScanRunEvent = {
    name: "assurance/scan.run",
    data: input,
  };

  return inngest.send(event);
}
