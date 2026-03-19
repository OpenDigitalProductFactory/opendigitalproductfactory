import type { DpfClient } from "../client";
import type {
  Notification,
  PaginatedResponse,
  RegisterDeviceRequest,
} from "@dpf/types";

export function notificationsEndpoints(client: DpfClient) {
  return {
    list: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<Notification>>(
        `/api/v1/notifications${query ? `?${query}` : ""}`,
      );
    },

    markRead: (id: string) =>
      client.patch<Notification>(`/api/v1/notifications/${id}/read`, {}),

    registerDevice: (input: RegisterDeviceRequest) =>
      client.post<unknown>(
        "/api/v1/notifications/register-device",
        input,
      ),
  };
}
