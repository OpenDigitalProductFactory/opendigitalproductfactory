import type { DpfClient } from "../client";
import type {
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  MeResponse,
} from "@dpf/types";

export function authEndpoints(client: DpfClient) {
  return {
    login: (input: LoginRequest) =>
      client.post<LoginResponse>("/api/v1/auth/login", input),

    refresh: (input: RefreshRequest) =>
      client.post<LoginResponse>("/api/v1/auth/refresh", input),

    logout: (refreshToken?: string) =>
      client.post<void>(
        "/api/v1/auth/logout",
        refreshToken ? { refreshToken } : {},
      ),

    me: () => client.get<MeResponse>("/api/v1/auth/me"),
  };
}
