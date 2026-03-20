import { useCustomerStore } from "./customer.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockList = jest.fn();
const mockGetById = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    customer: {
      list: (...args: unknown[]) => mockList(...args),
      getById: (...args: unknown[]) => mockGetById(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakeCustomer = {
  id: "cust-1",
  accountId: "ACC-001",
  name: "Acme Corp",
  status: "prospect",
  contacts: [
    { id: "contact-1", name: "John Doe", email: "john@acme.com" },
  ],
  createdAt: "2026-03-19T00:00:00Z",
  updatedAt: "2026-03-19T00:00:00Z",
};

const fakeCustomer2 = {
  ...fakeCustomer,
  id: "cust-2",
  accountId: "ACC-002",
  name: "Widget Inc",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  useCustomerStore.setState({
    customers: [],
    selectedCustomer: null,
    isLoading: false,
    error: null,
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe("customer.store", () => {
  describe("fetchCustomers", () => {
    it("loads customers from API", async () => {
      mockList.mockResolvedValue({
        data: [fakeCustomer, fakeCustomer2],
        nextCursor: null,
      });

      await useCustomerStore.getState().fetchCustomers();

      const state = useCustomerStore.getState();
      expect(state.customers).toHaveLength(2);
      expect(state.customers[0].name).toBe("Acme Corp");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("passes search parameter to API", async () => {
      mockList.mockResolvedValue({ data: [fakeCustomer], nextCursor: null });

      await useCustomerStore.getState().fetchCustomers("acme");

      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ search: "acme" }),
      );
    });

    it("sets error on API failure", async () => {
      mockList.mockRejectedValue(new Error("Server error"));

      await useCustomerStore.getState().fetchCustomers();

      const state = useCustomerStore.getState();
      expect(state.customers).toEqual([]);
      expect(state.error).toBe("Server error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("fetchDetail", () => {
    it("loads a single customer by ID", async () => {
      mockGetById.mockResolvedValue(fakeCustomer);

      await useCustomerStore.getState().fetchDetail("cust-1");

      const state = useCustomerStore.getState();
      expect(state.selectedCustomer).toEqual(fakeCustomer);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockGetById.mockRejectedValue(new Error("Not found"));

      await useCustomerStore.getState().fetchDetail("cust-999");

      const state = useCustomerStore.getState();
      expect(state.selectedCustomer).toBeNull();
      expect(state.error).toBe("Not found");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("updateCustomer", () => {
    it("validates and updates a customer", async () => {
      useCustomerStore.setState({
        customers: [fakeCustomer as any],
        selectedCustomer: fakeCustomer as any,
      });
      const updated = { ...fakeCustomer, name: "Acme Corp Updated" };
      mockUpdate.mockResolvedValue(updated);

      await useCustomerStore
        .getState()
        .updateCustomer("cust-1", { name: "Acme Corp Updated" });

      const state = useCustomerStore.getState();
      expect(state.selectedCustomer?.name).toBe("Acme Corp Updated");
      expect(state.customers[0].name).toBe("Acme Corp Updated");
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it("sets error on validation failure", async () => {
      await useCustomerStore
        .getState()
        .updateCustomer("cust-1", { name: "" });

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(useCustomerStore.getState().error).toBeTruthy();
    });

    it("sets error on API failure", async () => {
      useCustomerStore.setState({
        customers: [fakeCustomer as any],
        selectedCustomer: fakeCustomer as any,
      });
      mockUpdate.mockRejectedValue(new Error("Forbidden"));

      await useCustomerStore
        .getState()
        .updateCustomer("cust-1", { name: "Valid Name" });

      expect(useCustomerStore.getState().error).toBe("Forbidden");
      expect(useCustomerStore.getState().isLoading).toBe(false);
    });
  });
});
