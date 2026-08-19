import { request, type Dispatcher } from "undici";

export interface FacebookGraphError extends Error {
  statusCode?: number;
}

export interface FacebookGraphErrorFactory<E extends FacebookGraphError = FacebookGraphError> {
  (message: string, opts?: { statusCode?: number }): E;
}

interface FacebookGraphRequestOptions<E extends FacebookGraphError> {
  path: string;
  searchParams: URLSearchParams;
  dispatcher?: Dispatcher;
  surfaceLabel: string;
  invalidAccessMessage: string;
  createError: FacebookGraphErrorFactory<E>;
}

export function resolveFacebookGraphApiBaseUrl(): string {
  return process.env.FACEBOOK_GRAPH_API_BASE_URL ?? "https://graph.facebook.com";
}

export async function requestFacebookGraphJson<
  T,
  E extends FacebookGraphError = FacebookGraphError,
>(
  options: FacebookGraphRequestOptions<E>,
): Promise<T> {
  const url = `${resolveFacebookGraphApiBaseUrl()}/${options.path}?${options.searchParams.toString()}`;

  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "GET",
      dispatcher: options.dispatcher,
      headers: {
        accept: "application/json",
      },
    });
  } catch {
    throw options.createError(
      `Meta ${options.surfaceLabel} request failed — check network reachability and try again.`,
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw options.createError(options.invalidAccessMessage, {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw options.createError(
      `Meta ${options.surfaceLabel} request failed with status ${response.statusCode}`,
      { statusCode: response.statusCode },
    );
  }

  return (await response.body.json()) as T;
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
