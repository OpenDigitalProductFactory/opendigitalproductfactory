import type { InstanceStanceProfile } from "@dpf/db/installation-instance-stance";
import { readInstallHostProfile, type InstallHostProfile } from "@/lib/install/host-profile";
import { buildAgentHostInstructions } from "./agent-host-instructions";

/** One recoverable, secret-free projection for connect-time and profile reads. */
export async function loadAgentHostContext(
  authority: Parameters<typeof buildAgentHostInstructions>[1],
  installationLabel?: string,
) {
  const [host, stanceRead] = await Promise.allSettled([
    readInstallHostProfile(),
    (async () => {
      const [{ loadInstanceStance, prismaInstanceStanceStore }, { prisma }] = await Promise.all([
        import("@/lib/install/instance-stance"), import("@dpf/db"),
      ]);
      return loadInstanceStance(prismaInstanceStanceStore(prisma));
    })(),
  ]);
  const hostProfile: InstallHostProfile = host.status === "fulfilled" ? host.value : {
    kind: "unknown", installMode: null, sourceCapable: false, releaseImage: false,
    reason: "insufficient-install-evidence",
  };
  const stance: InstanceStanceProfile | null = stanceRead.status === "fulfilled" ? stanceRead.value : null;
  return {
    hostProfile,
    stance,
    stanceStatus: stance ? "resolved" as const : "unknown" as const,
    instructions: buildAgentHostInstructions(hostProfile, authority, stance ?? undefined, installationLabel),
  };
}
