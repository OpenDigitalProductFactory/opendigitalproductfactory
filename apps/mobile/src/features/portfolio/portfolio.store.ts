import { create } from "zustand";
import type { Portfolio } from "@dpf/types";
import { api } from "@/src/lib/apiClient";
import { CacheRepository } from "@/src/repositories/CacheRepository";

const CACHE_KEY_TREE = "portfolio:tree";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface PortfolioState {
  portfolios: Portfolio[];
  selectedPortfolio: Portfolio | null;
  isLoading: boolean;
  error: string | null;
  fetchTree: () => Promise<void>;
  fetchDetail: (id: string) => Promise<void>;
}

let cache: CacheRepository | null = null;

function getCache(): CacheRepository {
  if (!cache) cache = new CacheRepository();
  return cache;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  portfolios: [],
  selectedPortfolio: null,
  isLoading: false,
  error: null,

  fetchTree: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.portfolio.tree();
      set({ portfolios: res.portfolios, isLoading: false });
      getCache().set(CACHE_KEY_TREE, res.portfolios, CACHE_TTL);
    } catch (err) {
      const cached = getCache().get<Portfolio[]>(CACHE_KEY_TREE);
      if (cached) {
        set({
          portfolios: cached,
          isLoading: false,
          error: "Using cached data — last fetch failed.",
        });
      } else {
        set({
          isLoading: false,
          error:
            err instanceof Error ? err.message : "Failed to load portfolios",
        });
      }
    }
  },

  fetchDetail: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const portfolio = await api.portfolio.getById(id);
      set({ selectedPortfolio: portfolio, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to load portfolio detail",
      });
    }
  },
}));
