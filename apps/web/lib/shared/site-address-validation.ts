export type ValidatedSiteAddress = {
  providerRef: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  regionCode: string | null;
  country: string;
  countryCode: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  precision: string | null;
  validationSource: string;
};

export async function searchValidatedSiteAddresses(
  _query: string,
): Promise<ValidatedSiteAddress[]> {
  return [];
}

export async function resolveValidatedSiteAddress(
  _providerRef: string,
): Promise<ValidatedSiteAddress> {
  throw new Error(
    "Validated site address resolution is not configured yet. Connect an address validation provider first.",
  );
}
