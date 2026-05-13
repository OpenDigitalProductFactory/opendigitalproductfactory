import type { CoworkerMode } from "./agent-external-access-session";

type Input = {
  pathname: string;
  devMode: boolean;
  useUnifiedCoworker: boolean;
  coworkerMode: CoworkerMode;
  externalAccessEnabled: boolean;
};

type Output = {
  coworkerMode: CoworkerMode;
  externalAccessEnabled: boolean;
};

export function resolveCoworkerRuntimeMode(input: Input): Output {
  if (input.pathname.startsWith("/build")) {
    return {
      coworkerMode: "act",
      externalAccessEnabled: true,
    };
  }

  if (input.devMode) {
    return {
      coworkerMode: "act",
      externalAccessEnabled: input.externalAccessEnabled,
    };
  }

  if (!input.useUnifiedCoworker) {
    return {
      coworkerMode: "act",
      externalAccessEnabled: input.externalAccessEnabled,
    };
  }

  return {
    coworkerMode: input.coworkerMode,
    externalAccessEnabled: input.externalAccessEnabled,
  };
}
