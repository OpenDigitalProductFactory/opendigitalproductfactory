import type { DpfClient } from "../client";
import type { Portfolio, PaginatedResponse } from "@dpf/types";

export function portfolioEndpoints(client: DpfClient) {
  return {
    tree: () =>
      client.get<{ portfolios: Portfolio[] }>("/api/v1/portfolio/tree"),

    getById: (id: string) =>
      client.get<Portfolio>(`/api/v1/portfolio/${id}`),

    products: (
      id: string,
      params?: { cursor?: string; limit?: number },
    ) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<unknown>>(
        `/api/v1/portfolio/${id}/products${query ? `?${query}` : ""}`,
      );
    },
  };
}
