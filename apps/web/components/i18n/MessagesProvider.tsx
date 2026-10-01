"use client";

import type { ReactNode } from "react";

import { MessagesContext, type MessagesContextValue } from "@/lib/i18n/messages-context";

// Provides the request's language and the namespaces a subtree declares
// (EP-6B33A840 L0.2). The context itself lives in lib/i18n/messages-context.ts.

export function MessagesProvider({ locale, messages, children }: MessagesContextValue & { children: ReactNode }) {
  return <MessagesContext.Provider value={{ locale, messages }}>{children}</MessagesContext.Provider>;
}
