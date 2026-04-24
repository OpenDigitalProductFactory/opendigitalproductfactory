export interface AdpHarnessRoute {
  key: string;
  method: "GET" | "POST";
  path: string;
}

export const routes: AdpHarnessRoute[] = [
  { key: "token", method: "POST", path: "/oauth/token" },
  { key: "workers", method: "GET", path: "/hr/v2/workers" },
  { key: "payStatements", method: "GET", path: "/payroll/v1/workers/{workerId}/pay-statements" },
  { key: "timeCards", method: "GET", path: "/time/v2/workers/{workerId}/time-cards" },
  { key: "deductions", method: "GET", path: "/payroll/v1/workers/{workerId}/deductions" },
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
