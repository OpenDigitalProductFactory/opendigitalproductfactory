// apps/web/app/(portal)/portal/account/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/customer-login");

  const account = session.user.accountId
    ? await prisma.customerAccount.findUnique({
        where: { accountId: session.user.accountId },
        include: {
          contacts: {
            select: { id: true, email: true, isActive: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : null;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Account Settings</h1>

      <div style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a40",
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Company</h2>
        <p style={{ fontSize: 14, color: "#e0e0ff" }}>{account?.name}</p>
        <p style={{ fontSize: 11, color: "#8888a0", fontFamily: "monospace" }}>{account?.accountId}</p>
      </div>

      <div style={{
        background: "#1a1a2e",
        border: "1px solid #2a2a40",
        borderRadius: 8,
        padding: 20,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Contacts</h2>
        {account?.contacts.map((c) => (
          <div key={c.id} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: "1px solid #2a2a40",
          }}>
            <div>
              <span style={{ fontSize: 13, color: "#e0e0ff" }}>{c.email}</span>
              <span style={{ fontSize: 10, color: "#8888a0", marginLeft: 8 }}>
                since {new Date(c.createdAt).toLocaleDateString()}
              </span>
            </div>
            <span style={{
              fontSize: 10,
              color: c.isActive ? "#4ade80" : "#8888a0",
            }}>
              {c.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
