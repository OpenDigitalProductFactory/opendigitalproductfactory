const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/welcome",
  "/customer-login",
  "/customer-signup",
  "/customer-link-account",
  "/customer-complete-profile",
  "/api/auth",
  "/api/health",
  "/api/calendar/feed",
  "/api/calendar/sync",
  "/api/docs",
];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}
