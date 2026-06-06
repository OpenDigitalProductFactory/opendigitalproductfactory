import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import {
  getPlatformTable,
  getPlatformTableGridData,
  type PlatformUser,
} from "@/lib/workbooks/platform-tables";
import { WorkbookError } from "@/lib/workbooks/workbook-service";
import { WorkbookGrid } from "@/components/workbooks/Grid";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ entityType: string }> };

export default async function PlatformTablePage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;

  const { entityType } = await params;
  const def = getPlatformTable(entityType);
  if (!def) notFound();

  const svcUser: PlatformUser = {
    id: user.id,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };

  let grid;
  try {
    grid = await getPlatformTableGridData(svcUser, entityType);
  } catch (e) {
    if (e instanceof WorkbookError && e.status === 403) redirect("/workbooks");
    if (e instanceof WorkbookError && e.status === 404) notFound();
    throw e;
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-6">
      <Link
        href="/workbooks"
        className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
      >
        <ChevronLeft className="h-4 w-4" /> Workbooks
      </Link>

      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{def.label}</h1>
          <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">
            platform data
          </span>
          {!grid.schema.capabilities.canEditCell && (
            <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">
              read-only
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--dpf-muted)]">{def.description}</p>
      </div>

      <div className="min-h-0 flex-1">
        <WorkbookGrid
          source="platform"
          tableId={entityType}
          columns={grid.schema.columns}
          rows={grid.rows}
          capabilities={grid.schema.capabilities}
        />
      </div>
    </div>
  );
}
