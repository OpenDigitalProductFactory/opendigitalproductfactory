import type { ApiError } from "@dpf/types";
import type { ApiClientConfig } from "./types";

export class DpfClient {
  constructor(private config: ApiClientConfig) {}

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.config.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && this.config.onTokenExpired) {
      const newToken = await this.config.onTokenExpired();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
        const retry = await fetch(`${this.config.baseUrl}${path}`, {
          ...options,
          headers,
        });
        if (!retry.ok) throw await this.parseError(retry);
        if (retry.status === 204) return undefined as T;
        return (await retry.json()) as T;
      }
    }

    if (!response.ok) throw await this.parseError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async parseError(response: Response): Promise<ApiError> {
    try {
      return (await response.json()) as ApiError;
    } catch {
      return { code: "UNKNOWN", message: response.statusText };
    }
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  async upload<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: formData,
      headers: {}, // let browser set Content-Type with boundary
    });
  }
}
