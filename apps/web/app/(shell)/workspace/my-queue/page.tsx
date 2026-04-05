// apps/web/app/(shell)/workspace/my-queue/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";

const URGENCY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  priority: 2,
  routine: 3,
};

const URGENCY_COLORS: Record<string, string> = {
  emergency: "bg-red-100 text-red-800 border-red-300",
  urgent: "bg-orange-100 text-orange-800 border-orange-300",
  priority: "bg-yellow-100 text-yellow-800 border-yellow-300",
  routine: "bg-gray-100 text-gray-700 border-gray-300",
};

const EFFORT_LABELS: Record<string, string> = {
  instant: "Quick",
  short: "Short",
  medium: "Medium",
  long: "Long",
  physical: "Physical",
};

export default async function MyQueuePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const items = await prisma.workItem.findMany({
    where: {
      OR: [
        { assignedToUserId: session.user.id },
        { status: "queued", assignedToUserId: null },
      ],
      status: { notIn: ["completed", "cancelled"] },
    },
    orderBy: [{ createdAt: "asc" }],
    take: 100,
  });

  // Sort by urgency then date
  const sorted = [...items].sort((a, b) => {
    const ua = URGENCY_ORDER[a.urgency] ?? 99;
    const ub = URGENCY_ORDER[b.urgency] ?? 99;
    if (ua !== ub) return ua - ub;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">My Queue</h1>

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">No items in your queue</p>
          <p className="text-sm mt-1">Work items will appear here when assigned to you or available for claiming.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => (
            <div
              key={item.id}
              className="border rounded-lg p-4 bg-white shadow-sm flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${URGENCY_COLORS[item.urgency] ?? URGENCY_COLORS.routine}`}
                  >
                    {item.urgency}
                  </span>
                  <span className="text-xs text-gray-500">
                    {EFFORT_LABELS[item.effortClass] ?? item.effortClass}
                  </span>
                  <span className="text-xs text-gray-400">
                    {item.sourceType}
                  </span>
                </div>
                <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{item.description}</p>
                {item.dueAt && (
                  <p className="text-xs text-gray-400 mt-1">
                    Due: {new Date(item.dueAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                  {item.status}
                </span>
                {item.assignedToUserId === session.user.id ? (
                  <span className="text-xs text-green-600">Assigned to you</span>
                ) : (
                  <span className="text-xs text-gray-400">Unassigned</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
