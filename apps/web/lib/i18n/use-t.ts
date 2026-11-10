"use client";

import type { MessageKey, Namespace } from "@dpf/i18n";
import { formatSource, type MessageArgs } from "@dpf/i18n/runtime";

import { useMessagesContext } from "./messages-context";

/**
 * A translator for client components (EP-6B33A840 L0.2). The namespace must be
 * provided by a MessagesProvider above; a key it cannot find renders as the
 * key itself, never an empty string.
 */
export function useT<N extends Namespace>(namespace: N) {
  const { locale, messages } = useMessagesContext();
  const table = messages[namespace] ?? {};
  return (key: MessageKey<N>, args?: MessageArgs) => {
    const source = table[key];
    return source === undefined ? `${namespace}.${key}` : formatSource(locale, source, args);
  };
}
