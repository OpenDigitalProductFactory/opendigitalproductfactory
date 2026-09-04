import { inngest, type LocalModelInstallEvent } from "./inngest-client";

export function enqueueLocalModelInstall(
  data: LocalModelInstallEvent["data"],
  id: string,
) {
  return inngest.send({
    id,
    name: "inference/local-model.install",
    data,
  });
}
