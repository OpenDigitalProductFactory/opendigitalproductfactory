"use client";

import { signIn } from "next-auth/react";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <path d="M13.784 9.168c-.023-2.344 1.913-3.468 2-3.524-1.088-1.592-2.784-1.81-3.388-1.835-1.442-.146-2.816.849-3.548.849-.732 0-1.864-.828-3.064-.806-1.578.023-3.032.917-3.844 2.332-1.64 2.844-.42 7.058 1.178 9.368.78 1.128 1.712 2.396 2.936 2.352 1.178-.047 1.622-.762 3.046-.762 1.424 0 1.822.762 3.064.738 1.268-.023 2.07-1.15 2.844-2.284.896-1.31 1.266-2.578 1.288-2.644-.028-.013-2.472-.949-2.496-3.766zM11.438 2.52c.648-.786 1.086-1.878.966-2.966-.934.038-2.064.622-2.734 1.407-.6.695-1.126 1.806-.986 2.872 1.042.081 2.106-.53 2.754-1.314z"/>
    </svg>
  );
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  fontSize: 14,
  borderRadius: 6,
  border: "1px solid #2a2a40",
  background: "#0d0d18",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

export function SocialButtons() {
  return (
    <>
      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/portal" })}
        style={{ ...buttonStyle, marginBottom: 8 }}
      >
        <GoogleIcon />
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => signIn("apple", { callbackUrl: "/portal" })}
        style={buttonStyle}
      >
        <AppleIcon />
        Continue with Apple
      </button>
    </>
  );
}

export function SocialDivider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#2a2a40" }} />
      <span style={{ color: "#8888a0", fontSize: 12 }}>or sign in with email</span>
      <div style={{ flex: 1, height: 1, background: "#2a2a40" }} />
    </div>
  );
}
