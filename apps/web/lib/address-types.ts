/**
 * Shared address type used across employee UI components.
 * Represents an EmployeeAddress join record with its full
 * Address -> City -> Region -> Country hierarchy.
 */
export type AddressWithHierarchy = {
  id: string;
  isPrimary: boolean;
  address: {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    validatedAt: Date | null;
    validationSource: string | null;
    city: {
      id: string;
      name: string;
      region: {
        id: string;
        name: string;
        code: string | null;
        country: { id: string; name: string; iso2: string; phoneCode: string };
      };
    };
  };
};
