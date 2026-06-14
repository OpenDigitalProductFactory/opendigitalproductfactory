// apps/web/lib/communications/expo-push.ts
//
// Expo push transport — builds safe push messages and sends them via Expo's
// push service (https://exp.host/--/api/v2/push/send), which forwards to APNs
// (iOS) and FCM (Android). Pure + injectable for unit testing. Actual delivery
// requires the Expo project to be configured with APNs/FCM credentials
// (owner setup, BI-MOBAPP-ACCOUNTS); this transport stays correct regardless.

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const MAX_BODY = 240;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface ExpoPushResult {
  ok: boolean;
  ticketIds: string[];
  error?: string;
}

/** A registered token is an Expo push token. Guards against stray/invalid tokens. */
export function isExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")
  );
}

/**
 * Build push messages from device tokens + a notification. The body is capped
 * to keep payloads small; callers are responsible for passing a SAFE summary
 * (no sensitive prompt text) — the channel policy lives at the call site.
 */
export function buildExpoPushMessages(
  tokens: string[],
  input: { title: string; body: string; deepLink?: string },
): ExpoPushMessage[] {
  const body =
    input.body.length > MAX_BODY
      ? `${input.body.slice(0, MAX_BODY - 1)}…`
      : input.body;
  return tokens.filter(isExpoPushToken).map((to) => ({
    to,
    title: input.title,
    body,
    data: input.deepLink ? { deepLink: input.deepLink } : {},
  }));
}

/** POST messages to the Expo push service. `fetchImpl` is injectable for tests. */
export async function sendExpoPush(
  messages: ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoPushResult> {
  if (messages.length === 0) return { ok: true, ticketIds: [] };
  try {
    const res = await fetchImpl(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      return { ok: false, ticketIds: [], error: `Expo push HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      data?: { id?: string; status?: string }[];
    };
    const ticketIds = (json.data ?? [])
      .map((t) => t.id)
      .filter((id): id is string => Boolean(id));
    return { ok: true, ticketIds };
  } catch (e) {
    return {
      ok: false,
      ticketIds: [],
      error: e instanceof Error ? e.message : "Expo push request failed",
    };
  }
}
