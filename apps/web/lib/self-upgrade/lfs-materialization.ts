
// BI-224F56F1: implemented once in ../../../../scripts/lib/upgrade-source/lfs-materialization.mjs so the
// promoter-image source writer and the portal share one definition.
import * as impl from "../../../../scripts/lib/upgrade-source/lfs-materialization.mjs";

/** One LFS-tracked path in the workspace, and whether its real bytes are present. */
export interface LfsTrackedPath {
  /** Object id as `git lfs ls-files` prints it (short oid). */
  oid: string;
  /** Repo-relative path. */
  path: string;
  /** True when the working-tree file holds the object, false when it is a pointer stub. */
  materialized: boolean;
}

export const buildLfsPullCommand: (workspacePath: string) => string[] = impl.buildLfsPullCommand;
export const buildLfsLsFilesCommand: (workspacePath: string) => string[] = impl.buildLfsLsFilesCommand;
export const parseLfsLsFiles: (stdout: string) => LfsTrackedPath[] = impl.parseLfsLsFiles;
export const unmaterializedPaths: (tracked: LfsTrackedPath[]) => string[] = impl.unmaterializedPaths;
export const describeUnmaterialized: (paths: string[]) => string = impl.describeUnmaterialized;
