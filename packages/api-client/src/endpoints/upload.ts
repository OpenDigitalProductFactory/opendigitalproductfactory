import type { DpfClient } from "../client";
import type { UploadResponse } from "@dpf/types";

export function uploadEndpoints(client: DpfClient) {
  return {
    upload: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return client.upload<UploadResponse>("/api/v1/upload", formData);
    },
  };
}
