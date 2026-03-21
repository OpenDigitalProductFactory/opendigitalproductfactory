// GET /api/v1/ops/changes/:id — get a single RFC by rfcId
// PATCH /api/v1/ops/changes/:id — transition RFC status

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  getRFC,
  submitRFC,
  assessRFC,
  approveRFC,
  scheduleRFC,
  cancelRFC,
  transitionRFC,
} from "@/lib/actions/change-management";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id: rfcId } = await params;

    const rfc = await getRFC(rfcId);

    return apiSuccess(rfc);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    if (message.includes("not found")) {
      return NextResponse.json(
        { code: "NOT_FOUND", message },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id: rfcId } = await params;
    const body = await request.json();

    if (!body.action) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Action is required" },
        { status: 422 },
      );
    }

    switch (body.action) {
      case "submit":
        await submitRFC(rfcId);
        break;

      case "assess":
        if (!body.impactReport) {
          return NextResponse.json(
            { code: "VALIDATION_ERROR", message: "impactReport is required for assess action" },
            { status: 422 },
          );
        }
        await assessRFC(rfcId, body.impactReport);
        break;

      case "approve":
        await approveRFC(rfcId, body.rationale);
        break;

      case "schedule":
        if (!body.plannedStartAt) {
          return NextResponse.json(
            { code: "VALIDATION_ERROR", message: "plannedStartAt is required for schedule action" },
            { status: 422 },
          );
        }
        await scheduleRFC(
          rfcId,
          new Date(body.plannedStartAt),
          body.plannedEndAt ? new Date(body.plannedEndAt) : undefined,
          body.deploymentWindowId,
        );
        break;

      case "cancel":
        if (!body.reason?.trim()) {
          return NextResponse.json(
            { code: "VALIDATION_ERROR", message: "Reason is required for cancel action" },
            { status: 422 },
          );
        }
        await cancelRFC(rfcId, body.reason);
        break;

      case "reject":
        await transitionRFC(rfcId, "rejected", body.reason ? { outcomeNotes: body.reason } : undefined);
        break;

      default:
        return NextResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: `Unknown action: "${body.action}". Valid actions: submit, assess, approve, schedule, cancel, reject`,
          },
          { status: 422 },
        );
    }

    return apiSuccess({ rfcId, action: body.action, success: true });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    if (message.includes("not found")) {
      return NextResponse.json(
        { code: "NOT_FOUND", message },
        { status: 404 },
      );
    }
    if (message.includes("Invalid transition")) {
      return NextResponse.json(
        { code: "INVALID_TRANSITION", message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
