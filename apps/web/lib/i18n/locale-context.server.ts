import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import { resolveLocaleContext, type LocaleContext } from "@/lib/org-locale/locale-context";

/** Admin-only preview cookie: lets an operator view the portal in a pseudo-locale. */
export const LOCALE_PREVIEW_COOKIE = "dpf-locale";

const FALLBACK: LocaleContext = resolveLocaleContext({
  viewerIsAdmin: false,
  previewCookie: null,
  principalLanguage: null,
  principalTimeZone: null,
  orgDefaultLanguage: null,
  acceptLanguage: null,
  orgSettings: null,
  orgTimeZone: null,
});

/**
 * The request's LocaleContext (EP-6B33A840 L0.1). Resolved once per request and
 * never throws: a missing session, database or header resolves to the en-US
 * fallback so no page can fail to render over a locale lookup.
 */
export const getLocaleContext = cache(async (): Promise<LocaleContext> => {
  try {
    const [session, cookieStore, headerStore, orgSettings, businessProfile] = await Promise.all([
      auth().catch(() => null),
      cookies(),
      headers(),
      prisma.orgSettings
        .findFirst({ select: { baseCurrency: true, locale: true, countryCode: true } })
        .catch(() => null),
      prisma.businessProfile.findFirst({ select: { timezone: true } }).catch(() => null),
    ]);

    const user = session?.user;
    const principalRecordId = user?.id
      ? await resolvePrincipalRecordIdForSessionIdentity({ type: user.type, id: user.id }).catch(() => null)
      : null;
    const principal = principalRecordId
      ? await prisma.principal
          .findUnique({ where: { id: principalRecordId }, select: { preferredLanguage: true, timeZone: true } })
          .catch(() => null)
      : null;

    return resolveLocaleContext({
      viewerIsAdmin: user?.type === "admin",
      previewCookie: cookieStore.get(LOCALE_PREVIEW_COOKIE)?.value,
      principalLanguage: principal?.preferredLanguage,
      principalTimeZone: principal?.timeZone,
      orgDefaultLanguage: null, // OrgSettings.defaultLanguage arrives with L0.7 (BI-6982F7D9).
      acceptLanguage: headerStore.get("accept-language"),
      orgSettings,
      orgTimeZone: businessProfile?.timezone,
    });
  } catch {
    return FALLBACK;
  }
});
