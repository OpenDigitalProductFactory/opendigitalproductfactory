import type { DpfClient } from "../client";
import type {
  DynamicFormSchema,
  DynamicViewSchema,
  PaginatedResponse,
} from "@dpf/types";

export function dynamicEndpoints(client: DpfClient) {
  return {
    // Forms
    listForms: () =>
      client.get<PaginatedResponse<DynamicFormSchema>>(
        "/api/v1/dynamic/forms",
      ),

    getForm: (id: string) =>
      client.get<DynamicFormSchema>(`/api/v1/dynamic/forms/${id}`),

    submitForm: (id: string, data: Record<string, unknown>) =>
      client.post<unknown>(`/api/v1/dynamic/forms/${id}/submit`, data),

    // Views
    listViews: () =>
      client.get<PaginatedResponse<DynamicViewSchema>>(
        "/api/v1/dynamic/views",
      ),

    getViewData: (id: string) =>
      client.get<unknown>(`/api/v1/dynamic/views/${id}/data`),
  };
}
