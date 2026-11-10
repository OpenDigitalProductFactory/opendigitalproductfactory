import type { CoworkerMode } from "./agent-external-access-session";

type Input = {
  pathname: string;
  devMode: boolean;
  useUnifiedCoworker: boolean;
  coworkerMode: CoworkerMode;
};

type Output = {
  coworkerMode: CoworkerMode;
};

/**
 * The composer's Advise / Act mode for a turn. Build Studio always acts; dev
 * mode and the legacy (non-unified) coworker always act; otherwise the user's
 * choice. Web access is NOT resolved here any more — it follows the Workroom
 * and the coworker's standing grant, server-side (EP-WORK-POSTURE 8.2).
 */
export function resolveCoworkerRuntimeMode(input: Input): Output {
  if (input.pathname.startsWith("/build")) return { coworkerMode: "act" };
  if (input.devMode) return { coworkerMode: "act" };
  if (!input.useUnifiedCoworker) return { coworkerMode: "act" };
  return { coworkerMode: input.coworkerMode };
}
