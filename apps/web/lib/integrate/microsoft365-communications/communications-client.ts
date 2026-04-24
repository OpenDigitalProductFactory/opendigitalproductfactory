import { request, type Dispatcher } from "undici";

export interface Microsoft365CommunicationsProbeInput {
  mailboxUserPrincipalName: string;
  accessToken: string;
}

interface Microsoft365CommunicationsDeps {
  dispatcher?: Dispatcher;
  graphGet?: <T>(path: string) => Promise<T>;
}

export interface Microsoft365CommunicationsProbeResult {
  tenant: {
    id: string;
    displayName: string;
  };
  mailbox: {
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string | null;
  };
  recentMessages: Array<{
    id: string;
    subject: string;
    receivedDateTime: string;
    isRead: boolean;
    from: {
      name: string | null;
      address: string | null;
    };
  }>;
  upcomingEvents: Array<{
    id: string;
    subject: string;
    start: {
      dateTime: string;
      timeZone: string | null;
    };
    end: {
      dateTime: string;
      timeZone: string | null;
    };
    location: {
      displayName: string | null;
    };
  }>;
  joinedTeams: Array<{
    id: string;
    displayName: string;
    description: string | null;
  }>;
  firstTeamChannels: Array<{
    id: string;
    displayName: string;
    membershipType: string | null;
  }>;
  recentChannelMessages: Array<{
    id: string;
    createdDateTime: string;
    from: {
      displayName: string | null;
    };
    bodyPreview: string;
  }>;
}

export function resolveMicrosoftGraphBaseUrl(): string {
  return process.env.MICROSOFT365_GRAPH_BASE_URL ?? "https://graph.microsoft.com";
}

async function graphGet<T>(
  path: string,
  accessToken: string,
  deps: Microsoft365CommunicationsDeps,
): Promise<T> {
  const response = await request(`${resolveMicrosoftGraphBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
    dispatcher: deps.dispatcher,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Graph communications read failed with status ${response.statusCode}`);
  }

  return (await response.body.json()) as T;
}

export async function probeMicrosoft365Communications(
  input: Microsoft365CommunicationsProbeInput,
  deps: Microsoft365CommunicationsDeps = {},
): Promise<Microsoft365CommunicationsProbeResult> {
  const mailboxPathId = encodeURIComponent(input.mailboxUserPrincipalName);
  const get = <T,>(path: string) =>
    deps.graphGet
      ? deps.graphGet<T>(path)
      : graphGet<T>(path, input.accessToken, deps);

  const [organizationPayload, mailboxPayload, messagesPayload, eventsPayload, teamsPayload] =
    await Promise.all([
      get<{
        value?: Array<{ id?: string; displayName?: string }>;
      }>("/v1.0/organization?$select=id,displayName"),
      get<{
        id?: string;
        displayName?: string;
        userPrincipalName?: string;
        mail?: string | null;
      }>(`/v1.0/users/${mailboxPathId}?$select=id,displayName,userPrincipalName,mail`),
      get<{
        value?: Array<{
          id?: string;
          subject?: string;
          receivedDateTime?: string;
          isRead?: boolean;
          from?: { emailAddress?: { name?: string | null; address?: string | null } };
        }>;
      }>(`/v1.0/users/${mailboxPathId}/mailFolders/Inbox/messages?$top=5&$select=id,subject,receivedDateTime,isRead,from&$orderby=receivedDateTime desc`),
      get<{
        value?: Array<{
          id?: string;
          subject?: string;
          start?: { dateTime?: string; timeZone?: string | null };
          end?: { dateTime?: string; timeZone?: string | null };
          location?: { displayName?: string | null };
        }>;
      }>(`/v1.0/users/${mailboxPathId}/calendar/events?$top=5&$select=id,subject,start,end,location`),
      get<{
        value?: Array<{ id?: string; displayName?: string; description?: string | null }>;
      }>(`/v1.0/users/${mailboxPathId}/joinedTeams?$top=5&$select=id,displayName,description`),
    ]);

  const organization = organizationPayload.value?.[0];
  if (!organization?.id || !organization.displayName) {
    throw new Error("Graph communications probe returned no tenant summary");
  }

  if (
    !mailboxPayload?.id ||
    !mailboxPayload.displayName ||
    !mailboxPayload.userPrincipalName
  ) {
    throw new Error("Graph communications probe returned no mailbox summary");
  }

  const joinedTeams = (teamsPayload.value ?? []).flatMap((team) =>
    typeof team.id === "string" && typeof team.displayName === "string"
      ? [
          {
            id: team.id,
            displayName: team.displayName,
            description: typeof team.description === "string" ? team.description : null,
          },
        ]
      : [],
  );

  const firstTeamId = joinedTeams[0]?.id ?? null;

  const channelsPayload = firstTeamId
    ? await get<{
        value?: Array<{ id?: string; displayName?: string; membershipType?: string | null }>;
      }>(`/v1.0/teams/${encodeURIComponent(firstTeamId)}/channels?$top=5&$select=id,displayName,membershipType`)
    : { value: [] };

  const firstTeamChannels = (channelsPayload.value ?? []).flatMap((channel) =>
    typeof channel.id === "string" && typeof channel.displayName === "string"
      ? [
          {
            id: channel.id,
            displayName: channel.displayName,
            membershipType:
              typeof channel.membershipType === "string" ? channel.membershipType : null,
          },
        ]
      : [],
  );

  const firstChannelId = firstTeamChannels[0]?.id ?? null;

  const messagesByChannelPayload = firstTeamId && firstChannelId
    ? await get<{
        value?: Array<{
          id?: string;
          createdDateTime?: string;
          from?: { user?: { displayName?: string | null } };
          body?: { content?: string | null };
        }>;
      }>(`/v1.0/teams/${encodeURIComponent(firstTeamId)}/channels/${encodeURIComponent(firstChannelId)}/messages?$top=5&$select=id,createdDateTime,from,body`)
    : { value: [] };

  return {
    tenant: {
      id: organization.id,
      displayName: organization.displayName,
    },
    mailbox: {
      id: mailboxPayload.id,
      displayName: mailboxPayload.displayName,
      userPrincipalName: mailboxPayload.userPrincipalName,
      mail: typeof mailboxPayload.mail === "string" ? mailboxPayload.mail : null,
    },
    recentMessages: (messagesPayload.value ?? []).flatMap((message) =>
      typeof message.id === "string" &&
      typeof message.subject === "string" &&
      typeof message.receivedDateTime === "string" &&
      typeof message.isRead === "boolean"
        ? [
            {
              id: message.id,
              subject: message.subject,
              receivedDateTime: message.receivedDateTime,
              isRead: message.isRead,
              from: {
                name:
                  typeof message.from?.emailAddress?.name === "string"
                    ? message.from.emailAddress.name
                    : null,
                address:
                  typeof message.from?.emailAddress?.address === "string"
                    ? message.from.emailAddress.address
                    : null,
              },
            },
          ]
        : [],
    ),
    upcomingEvents: (eventsPayload.value ?? []).flatMap((event) =>
      typeof event.id === "string" &&
      typeof event.subject === "string" &&
      typeof event.start?.dateTime === "string" &&
      typeof event.end?.dateTime === "string"
        ? [
            {
              id: event.id,
              subject: event.subject,
              start: {
                dateTime: event.start.dateTime,
                timeZone:
                  typeof event.start.timeZone === "string" ? event.start.timeZone : null,
              },
              end: {
                dateTime: event.end.dateTime,
                timeZone: typeof event.end.timeZone === "string" ? event.end.timeZone : null,
              },
              location: {
                displayName:
                  typeof event.location?.displayName === "string"
                    ? event.location.displayName
                    : null,
              },
            },
          ]
        : [],
    ),
    joinedTeams,
    firstTeamChannels,
    recentChannelMessages: (messagesByChannelPayload.value ?? []).flatMap((message) =>
      typeof message.id === "string" && typeof message.createdDateTime === "string"
        ? [
            {
              id: message.id,
              createdDateTime: message.createdDateTime,
              from: {
                displayName:
                  typeof message.from?.user?.displayName === "string"
                    ? message.from.user.displayName
                    : null,
              },
              bodyPreview: stripHtml(message.body?.content),
            },
          ]
        : [],
    ),
  };
}

function stripHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
