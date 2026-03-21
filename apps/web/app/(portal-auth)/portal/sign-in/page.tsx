import { SignInForm } from "@/components/storefront/SignInForm";

export default function PortalSignInPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--dpf-bg)",
      padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--dpf-text)", marginBottom: 24, textAlign: "center" }}>
          Customer sign in
        </h1>
        <SignInForm />
      </div>
    </div>
  );
}
