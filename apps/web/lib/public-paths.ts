const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/api/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}
