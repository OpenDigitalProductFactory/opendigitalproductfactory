import { jobs, type AssuranceScanRunEvent } from "@/lib/jobs";

export async function queueBuildAssuranceScan(input: { buildId: string; requestedByUserId: string }) {
  const event: AssuranceScanRunEvent = {
    name: "assurance/scan.run",
    data: input,
  };

  return jobs.send(event);
}
