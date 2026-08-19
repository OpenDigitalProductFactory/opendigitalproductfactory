export function summarizeGovernedLifecycleAttempt(input: {
  actorIsSuperuser: boolean;
  targetIsSuperuser: boolean;
}): { decision: "allow" | "deny"; message: string } {
  if (input.targetIsSuperuser && !input.actorIsSuperuser) {
    return {
      decision: "deny",
      message: "Only a superuser can change another superuser account.",
    };
  }

  return {
    decision: "allow",
    message: "Lifecycle update permitted.",
  };
}
