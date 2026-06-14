export interface ApiClientConfig {
  /**
   * Base URL of the target DPF install, e.g. "https://acme.dpf.example".
   * Pass a function instead of a string when the active install can change at
   * runtime — the mobile app lets a user connect to their own org's install,
   * so it supplies a resolver that reads the current install URL per request.
   */
  baseUrl: string | (() => string);
  getToken: () => Promise<string | null>;
  onTokenExpired?: () => Promise<string | null>; // refresh callback
}
