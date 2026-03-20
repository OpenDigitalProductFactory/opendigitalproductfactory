import { http, HttpResponse } from "msw";

export const authHandlers = [
  http.post("*/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as any;
    if (body.email === "test@example.com" && body.password === "password") {
      return HttpResponse.json({
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        expiresIn: 900,
      });
    }
    return HttpResponse.json(
      { code: "INVALID_CREDENTIALS", message: "Invalid credentials" },
      { status: 401 },
    );
  }),

  http.get("*/api/v1/auth/me", () => {
    return HttpResponse.json({
      id: "user-1",
      email: "test@example.com",
      platformRole: "HR-000",
      isSuperuser: false,
      capabilities: ["view_portfolio", "manage_backlog"],
    });
  }),
];
