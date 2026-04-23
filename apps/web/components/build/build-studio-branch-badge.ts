export type BuildStudioBranchBadge = {
  kind: "submission" | "workspace";
  value: string;
  title: "Submission branch" | "Workspace branch";
};

type ResolveBuildStudioBranchBadgeInput = {
  submissionBranch?: string | null;
  submissionBranchShortId?: string | null;
  buildTitle?: string | null;
  workspaceBranch?: string | null;
};

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSubmissionBranch(shortId: string, buildTitle: string): string {
  const slug = buildTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `dpf/${shortId}/${slug}`;
}

export function resolveBuildStudioBranchBadge(
  input: ResolveBuildStudioBranchBadgeInput,
): BuildStudioBranchBadge | null {
  const explicitSubmissionBranch = normalize(input.submissionBranch);
  if (explicitSubmissionBranch) {
    return {
      kind: "submission",
      value: explicitSubmissionBranch,
      title: "Submission branch",
    };
  }

  const shortId = normalize(input.submissionBranchShortId);
  const buildTitle = normalize(input.buildTitle);
  if (shortId && buildTitle) {
    return {
      kind: "submission",
      value: buildSubmissionBranch(shortId, buildTitle),
      title: "Submission branch",
    };
  }

  const workspaceBranch = normalize(input.workspaceBranch);
  if (workspaceBranch) {
    return {
      kind: "workspace",
      value: workspaceBranch,
      title: "Workspace branch",
    };
  }

  return null;
}
