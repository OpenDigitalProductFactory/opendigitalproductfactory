export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  onTokenExpired?: () => Promise<string | null>; // refresh callback
}
