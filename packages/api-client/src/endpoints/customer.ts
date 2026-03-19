import type { DpfClient } from "../client";
import type {
  CustomerAccount,
  PaginatedResponse,
  UpdateCustomerRequest,
} from "@dpf/types";

export function customerEndpoints(client: DpfClient) {
  return {
    list: (params?: {
      cursor?: string;
      limit?: number;
      search?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      const query = qs.toString();
      return client.get<PaginatedResponse<CustomerAccount>>(
        `/api/v1/customer/accounts${query ? `?${query}` : ""}`,
      );
    },

    getById: (id: string) =>
      client.get<CustomerAccount>(`/api/v1/customer/accounts/${id}`),

    update: (id: string, input: UpdateCustomerRequest) =>
      client.patch<CustomerAccount>(
        `/api/v1/customer/accounts/${id}`,
        input,
      ),
  };
}
