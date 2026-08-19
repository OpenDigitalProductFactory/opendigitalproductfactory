import { fetch, type Dispatcher } from "undici";

export interface EntraDirectorySnapshot {
  organization: {
    id: string;
    displayName: string;
    verifiedDomains: string[];
  };
  users: Array<{
    id: string;
    displayName: string;
    userPrincipalName: string;
    accountEnabled: boolean;
  }>;
  groups: Array<{
    id: string;
    displayName: string;
    mailEnabled: boolean;
    securityEnabled: boolean;
  }>;
}

export interface EntraDirectorySnapshotInput {
  accessToken: string;
}

interface EntraDirectoryDeps {
  dispatcher?: Dispatcher;
}

const GRAPH_BASE_URL = "https://graph.microsoft.com";

type GraphUserRecord = {
  id?: string;
  displayName?: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
};

type GraphGroupRecord = {
  id?: string;
  displayName?: string;
  mailEnabled?: boolean;
  securityEnabled?: boolean;
};

function isGraphUserRecord(
  user: GraphUserRecord,
): user is {
  id: string;
  displayName: string;
  userPrincipalName: string;
  accountEnabled: boolean;
} {
  return (
    typeof user.id === "string" &&
    typeof user.displayName === "string" &&
    typeof user.userPrincipalName === "string" &&
    typeof user.accountEnabled === "boolean"
  );
}

function isGraphGroupRecord(
  group: GraphGroupRecord,
): group is {
  id: string;
  displayName: string;
  mailEnabled: boolean;
  securityEnabled: boolean;
} {
  return (
    typeof group.id === "string" &&
    typeof group.displayName === "string" &&
    typeof group.mailEnabled === "boolean" &&
    typeof group.securityEnabled === "boolean"
  );
}

async function graphGet<T>(
  path: string,
  accessToken: string,
  deps: EntraDirectoryDeps
): Promise<T> {
  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    dispatcher: deps.dispatcher,
  });

  if (!response.ok) {
    throw new Error(`Graph read failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchDirectorySnapshot(
  input: EntraDirectorySnapshotInput,
  deps: EntraDirectoryDeps = {}
): Promise<EntraDirectorySnapshot> {
  const [organizationPayload, usersPayload, groupsPayload] = await Promise.all([
    graphGet<{
      value?: Array<{
        id?: string;
        displayName?: string;
        verifiedDomains?: Array<{ name?: string }>;
      }>;
    }>("/v1.0/organization?$select=id,displayName,verifiedDomains", input.accessToken, deps),
    graphGet<{
      value?: GraphUserRecord[];
    }>(
      "/v1.0/users?$top=25&$select=id,displayName,userPrincipalName,accountEnabled",
      input.accessToken,
      deps
    ),
    graphGet<{
      value?: GraphGroupRecord[];
    }>(
      "/v1.0/groups?$top=25&$select=id,displayName,mailEnabled,securityEnabled",
      input.accessToken,
      deps
    ),
  ]);

  const organization = organizationPayload.value?.[0];
  if (!organization?.id || !organization.displayName) {
    throw new Error("Graph organization probe returned no tenant summary");
  }

  const userRecords = (usersPayload.value ?? []).filter(isGraphUserRecord);
  const groupRecords = (groupsPayload.value ?? []).filter(isGraphGroupRecord);

  return {
    organization: {
      id: organization.id,
      displayName: organization.displayName,
      verifiedDomains: (organization.verifiedDomains ?? [])
        .map((domain) => domain.name)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    },
    users: userRecords.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      accountEnabled: user.accountEnabled,
    })),
    groups: groupRecords.map((group) => ({
      id: group.id,
      displayName: group.displayName,
      mailEnabled: group.mailEnabled,
      securityEnabled: group.securityEnabled,
    })),
  };
}
