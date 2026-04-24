export interface QuickBooksHarnessRoute {
  key: string;
  method: "GET" | "POST";
  path: string;
}

export const routes: QuickBooksHarnessRoute[] = [
  { key: "token", method: "POST", path: "/oauth2/v1/tokens/bearer" },
  {
    key: "companyInfo",
    method: "GET",
    path: "/v3/company/{realmId}/companyinfo/{realmId}",
  },
  {
    key: "customer",
    method: "GET",
    path: "/v3/company/{realmId}/customer/{customerId}",
  },
  {
    key: "invoice",
    method: "GET",
    path: "/v3/company/{realmId}/invoice/{invoiceId}",
  },
];

export const requiredScenarios = [
  "happy-path",
  "rate-limited",
  "auth-failure",
  "token-expired",
  "empty-list",
  "malformed-response",
  "jailbreak-content",
] as const;
