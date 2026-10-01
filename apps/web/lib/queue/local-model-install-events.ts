import { jobs, type LocalModelInstallEvent } from "@/lib/jobs";

export function enqueueLocalModelInstall(
  data: LocalModelInstallEvent["data"],
  id: string,
) {
  return jobs.send({
    id,
    name: "inference/local-model.install",
    data,
  });
}
