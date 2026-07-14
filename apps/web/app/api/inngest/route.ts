import { serve } from "inngest/next";
import { inngest } from "@/lib/queue/inngest-client";
import { getInngestFunctionsForRuntime } from "@/lib/queue/functions";

const served = serve({
  client: inngest,
  functions: getInngestFunctionsForRuntime(),
});

function recordGatewayHit(method: "GET" | "POST" | "PUT") {
  void import("@/lib/queue/job-engine-health")
    .then(({ recordInngestGatewayHit }) => recordInngestGatewayHit(method))
    .catch(() => {});
}

export async function GET(...args: Parameters<typeof served.GET>) {
  recordGatewayHit("GET");
  return served.GET(...args);
}

export async function POST(...args: Parameters<typeof served.POST>) {
  recordGatewayHit("POST");
  return served.POST(...args);
}

export async function PUT(...args: Parameters<typeof served.PUT>) {
  recordGatewayHit("PUT");
  return served.PUT(...args);
}
