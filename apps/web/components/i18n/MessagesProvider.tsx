"use client";

import { DEFAULT_LOCALE } from "@dpf/i18n/runtime";
import { createContext, useContext, type ReactNode } from "react";

// Carries the request's language and the MF2 sources for the namespaces a
// subtree declares, resolved on the server (EP-6B33A840 L0.2). Client code
// formats them with the client-safe @dpf/i18n/runtime, so no catalog JSON
// ships to the browser beyond what the page uses.

export interface MessagesContextValue {
  locale: string;
  messages: Record<string, Record<string, string>>;
}

const MessagesContext = createContext<MessagesContextValue>({ locale: DEFAULT_LOCALE, messages: {} });

export function MessagesProvider({ locale, messages, children }: MessagesContextValue & { children: ReactNode }) {
  return <MessagesContext.Provider value={{ locale, messages }}>{children}</MessagesContext.Provider>;
}

export function useMessagesContext(): MessagesContextValue {
  return useContext(MessagesContext);
}
