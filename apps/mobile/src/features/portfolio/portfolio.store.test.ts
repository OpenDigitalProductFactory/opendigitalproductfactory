import { usePortfolioStore } from "./portfolio.store";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockTree = jest.fn();
const mockGetById = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    portfolio: {
      tree: (...args: unknown[]) => mockTree(...args),
      getById: (...args: unknown[]) => mockGetById(...args),
    },
  },
}));

jest.mock("@/src/repositories/CacheRepository", () => ({
  CacheRepository: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
  })),
}));

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

const fakePortfolio = {
  id: "port-1",
  slug: "platform",
  name: "Platform Portfolio",
  description: "Main platform portfolio",
  rootNodeId: null,
  budgetKUsd: 500,
  products: [{ id: "prod-1", name: "Web App" }],
  epicPortfolios: [],
  createdAt: "2026-03-19T00:00:00Z",
  updatedAt: "2026-03-19T00:00:00Z",
};

const fakePortfolio2 = {
  ...fakePortfolio,
  id: "port-2",
  slug: "mobile",
  name: "Mobile Portfolio",
  description: "Mobile apps",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetStore() {
  usePortfolioStore.setState({
    portfolios: [],
    selectedPortfolio: null,
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

describe("portfolio.store", () => {
  describe("fetchTree", () => {
    it("loads portfolios from API", async () => {
      mockTree.mockResolvedValue({
        portfolios: [fakePortfolio, fakePortfolio2],
      });

      await usePortfolioStore.getState().fetchTree();

      const state = usePortfolioStore.getState();
      expect(state.portfolios).toHaveLength(2);
      expect(state.portfolios[0].name).toBe("Platform Portfolio");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockTree.mockRejectedValue(new Error("Network error"));

      await usePortfolioStore.getState().fetchTree();

      const state = usePortfolioStore.getState();
      expect(state.portfolios).toEqual([]);
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
    });
  });

  describe("fetchDetail", () => {
    it("loads a single portfolio by ID", async () => {
      mockGetById.mockResolvedValue(fakePortfolio);

      await usePortfolioStore.getState().fetchDetail("port-1");

      const state = usePortfolioStore.getState();
      expect(state.selectedPortfolio).toEqual(fakePortfolio);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on API failure", async () => {
      mockGetById.mockRejectedValue(new Error("Not found"));

      await usePortfolioStore.getState().fetchDetail("port-999");

      const state = usePortfolioStore.getState();
      expect(state.selectedPortfolio).toBeNull();
      expect(state.error).toBe("Not found");
      expect(state.isLoading).toBe(false);
    });
  });
});
