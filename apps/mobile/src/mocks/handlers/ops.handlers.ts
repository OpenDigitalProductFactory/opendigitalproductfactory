import { http, HttpResponse } from "msw";

export const opsHandlers = [
  http.get("*/api/v1/ops/epics", () => {
    return HttpResponse.json({
      data: [
        {
          id: "1",
          epicId: "EP-TEST-001",
          title: "Test Epic",
          status: "open",
          items: [],
        },
      ],
      nextCursor: null,
    });
  }),
];
