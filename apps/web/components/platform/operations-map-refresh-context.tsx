"use client";
import { createContext, useContext } from "react";

// Presentation invalidation only. The shell retains window, fetch, error and timer ownership.
const OperationsMapRefreshContext = createContext<() => void>(() => {});
export const OperationsMapRefreshProvider = OperationsMapRefreshContext.Provider;
export function useOperationsMapRefresh(): () => void {
  return useContext(OperationsMapRefreshContext);
}
