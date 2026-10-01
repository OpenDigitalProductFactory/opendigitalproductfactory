import type { ReactNode } from "react";
import { SOURCE_CATALOG, namespaceMessages, type Namespace } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";

/** Wrap a component in the MessagesProvider the root layout supplies, for any locale (L0.2 tests). */
export function withMessages(ui: ReactNode, locale = "en-US") {
  const messages = Object.fromEntries(
    (Object.keys(SOURCE_CATALOG) as Namespace[]).map((ns) => [ns, namespaceMessages(locale, ns)]),
  );
  return (
    <MessagesProvider locale={locale} messages={messages}>
      {ui}
    </MessagesProvider>
  );
}
