// BI-085A37EC: the trail markers of a PR CI repair, apart from pr-ci-repair.ts so
// the publisher (github-api-commit.ts) can name them without an import cycle.
export const PR_CI_REPAIR_TOOL = "pr_ci_repair";
export const PR_FOLLOW_UP_PREFIX = "Pushed the repair to its pull request as a follow-up commit;";
export const PR_FOLLOW_UP_UNCHANGED_PREFIX = "The repair changed nothing on its pull request;";
export const PR_FOLLOW_UP_UNCHANGED = "Nothing was pushed: the CI repair changed nothing on the pull request.";
