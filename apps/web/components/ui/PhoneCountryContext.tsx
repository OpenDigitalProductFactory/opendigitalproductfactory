"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_PHONE_COUNTRY, type CountryCode } from "@/lib/phone";

const PhoneCountryContext = createContext<CountryCode>(DEFAULT_PHONE_COUNTRY);

/**
 * Provides the install's home country to descendant {@link PhoneInput}s so they
 * format national numbers correctly without each form passing `country`. The
 * value is resolved server-side (see `lib/phone-country.server.ts`) and handed
 * down here. An explicit `country` prop on a PhoneInput still wins.
 */
export function PhoneCountryProvider({
  country,
  children,
}: {
  country: CountryCode;
  children: ReactNode;
}) {
  return (
    <PhoneCountryContext.Provider value={country}>
      {children}
    </PhoneCountryContext.Provider>
  );
}

/** The ambient phone country (defaults to {@link DEFAULT_PHONE_COUNTRY} with no provider). */
export function usePhoneCountry(): CountryCode {
  return useContext(PhoneCountryContext);
}
