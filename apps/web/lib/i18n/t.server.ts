import "server-only";

import { translate, type MessageArgs, type MessageKey, type Namespace } from "@dpf/i18n";

import { getLocaleContext } from "./locale-context.server";

/**
 * A translator for server components and server actions (EP-6B33A840 L0.2).
 * Resolves the request's language once, then formats catalog keys:
 *   const t = await getT("errors");
 *   t("notFound.storefront.heading")
 */
export async function getT<N extends Namespace>(namespace: N) {
  const { language } = await getLocaleContext();
  return (key: MessageKey<N>, args?: MessageArgs) => translate(language, namespace, key, args);
}
