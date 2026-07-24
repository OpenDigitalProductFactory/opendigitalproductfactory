import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";
import { hasActiveOrgCapability } from "@/lib/storefront/org-capabilities.server";
import {
  MemberEquityPanel,
  type MemberEquityMemberRow,
} from "@/components/civic/MemberEquityPanel";

// Member equity & patronage ledger (BI-AFC178F3). Capability-gated on
// member-equity — required for cooperatives via archetype override, available
// later for member-owned utilities (capital credits).
export default async function MemberEquityPage() {
  if (!(await hasActiveOrgCapability("member-equity"))) notFound();

  const [accounts, entries] = await Promise.all([
    prisma.customerAccount.findMany({
      where: EXCLUDE_TOMBSTONED,
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, accountId: true, name: true, status: true },
    }),
    prisma.memberEquityEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        memberAccountId: true,
        fiscalYear: true,
        kind: true,
        amount: true,
        qualified: true,
      },
    }),
  ]);

  const balances = new Map<string, number>();
  const entryCounts = new Map<string, number>();
  for (const entry of entries) {
    balances.set(entry.memberAccountId, (balances.get(entry.memberAccountId) ?? 0) + Number(entry.amount));
    entryCounts.set(entry.memberAccountId, (entryCounts.get(entry.memberAccountId) ?? 0) + 1);
  }

  const rows: MemberEquityMemberRow[] = accounts.map((account) => ({
    id: account.id,
    accountId: account.accountId,
    name: account.name,
    status: account.status,
    balance: Math.round((balances.get(account.id) ?? 0) * 100) / 100,
    entryCount: entryCounts.get(account.id) ?? 0,
  }));

  const fiscalYear = new Date().getFullYear();
  const totalEquity = rows.reduce((sum, row) => sum + row.balance, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Member Equity</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {rows.length} member accounts · allocated equity {totalEquity.toFixed(2)} · patronage
          allocations, retains, and retirements
        </p>
      </div>
      <MemberEquityPanel members={rows} fiscalYear={fiscalYear} />
    </div>
  );
}
