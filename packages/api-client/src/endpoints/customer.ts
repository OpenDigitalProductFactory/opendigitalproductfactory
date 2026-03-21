import type { DpfClient } from "../client";
import type {
  ContactWithRoles,
  CreateContactRequest,
  CustomerAccount,
  PaginatedResponse,
  SimilarContact,
  UpdateContactRequest,
  UpdateCustomerRequest,
} from "@dpf/types";

export function customerEndpoints(client: DpfClient) {
  return {
    // --- Accounts ---
    list: (params?: {
      cursor?: string;
      limit?: number;
      search?: string;
      status?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.status) qs.set("status", params.status);
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

    // --- Contacts ---
    createContact: (input: CreateContactRequest) =>
      client.post<{
        contact: ContactWithRoles;
        similarContacts: SimilarContact[];
      }>(`/api/v1/customer/contacts`, input),

    getContact: (id: string) =>
      client.get<ContactWithRoles>(`/api/v1/customer/contacts/${id}`),

    updateContact: (id: string, input: UpdateContactRequest) =>
      client.patch<ContactWithRoles>(
        `/api/v1/customer/contacts/${id}`,
        input,
      ),

    searchContacts: (query: string) =>
      client.get<PaginatedResponse<ContactWithRoles>>(
        `/api/v1/customer/contacts?search=${encodeURIComponent(query)}`,
      ),
  };
}
