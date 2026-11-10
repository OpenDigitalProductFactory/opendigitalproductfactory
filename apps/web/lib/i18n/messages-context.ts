"use client";

import { DEFAULT_LOCALE } from "@dpf/i18n/runtime";
import { createContext, useContext } from "react";

// Carries the request's language and the MF2 sources for the namespaces a
// subtree declares, resolved on the server (EP-6B33A840 L0.2). Client code
// formats them with the client-safe @dpf/i18n/runtime, so no catalog JSON
// ships to the browser beyond what the page uses.
//
// The context and its reader live in lib so lib hooks (use-t.ts) never import
// components/**; components/i18n/MessagesProvider.tsx renders the provider.

export interface MessagesContextValue {
  locale: string;
  messages: Record<string, Record<string, string>>;
}

export const MessagesContext = createContext<MessagesContextValue>({ locale: DEFAULT_LOCALE, messages: {} });

export function useMessagesContext(): MessagesContextValue {
  return useContext(MessagesContext);
}
