import { prisma } from "@dpf/db";

import {
  COMMUNICATION_URGENCIES,
  type CommunicationUrgency,
} from "./channel-types";
import {
  parseChannelBindingInput,
  type ChannelBindingInput,
} from "./channel-bindings";

export interface CommunicationChannelBindingRow {
  bindingId: string;
  channelType: string;
  providerKey: string;
  providerAccountId: string;
  externalSubject: string;
  displayLabel: string;
  verificationStatus: string;
  allowedUrgencies: CommunicationUrgency[];
  isActive: boolean;
  lastTestedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  principalDisplayName: string;
  employeeDisplayName: string | null;
}

export interface CommunicationBindingDashboard {
  summary: {
    total: number;
    active: number;
    verified: number;
    failed: number;
    pending: number;
  };
  bindings: CommunicationChannelBindingRow[];
}

export interface CommunicationBindingActionResult {
  ok: boolean;
  message: string;
  bindingId?: string;
}

export async function listCommunicationChannelBindings(
  options: { take?: number } = {},
): Promise<CommunicationBindingDashboard> {
  const [rows, total, active, verified, failed, pending] = await Promise.all([
    prisma.communicationChannelBinding.findMany({
      take: options.take ?? 25,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        bindingId: true,
        channelType: true,
        providerKey: true,
        providerAccountId: true,
        externalSubject: true,
        displayLabel: true,
        verificationStatus: true,
        allowedUrgencies: true,
        isActive: true,
        lastTestedAt: true,
        lastVerifiedAt: true,
        lastError: true,
        principal: { select: { displayName: true } },
        employeeProfile: { select: { displayName: true } },
      },
    }),
    prisma.communicationChannelBinding.count(),
    prisma.communicationChannelBinding.count({ where: { isActive: true } }),
    prisma.communicationChannelBinding.count({ where: { verificationStatus: "verified" } }),
    prisma.communicationChannelBinding.count({ where: { verificationStatus: "failed" } }),
    prisma.communicationChannelBinding.count({ where: { verificationStatus: "pending" } }),
  ]);

  const bindings = rows.map((row) => ({
    bindingId: row.bindingId,
    channelType: row.channelType,
    providerKey: row.providerKey,
    providerAccountId: row.providerAccountId,
    externalSubject: row.externalSubject,
    displayLabel: row.displayLabel?.trim() || formatBindingLabel(row.providerKey, row.externalSubject),
    verificationStatus: row.verificationStatus,
    allowedUrgencies: normalizeUrgencies(row.allowedUrgencies),
    isActive: row.isActive,
    lastTestedAt: toIsoString(row.lastTestedAt),
    lastVerifiedAt: toIsoString(row.lastVerifiedAt),
    lastError: row.lastError,
    principalDisplayName: row.principal.displayName,
    employeeDisplayName: row.employeeProfile?.displayName ?? null,
  }));

  return {
    summary: {
      total,
      active,
      verified,
      failed,
      pending,
    },
    bindings,
  };
}

export async function createCommunicationChannelBinding(
  input: ChannelBindingInput,
): Promise<CommunicationBindingActionResult> {
  const parsed = parseChannelBindingInput(input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error };
  }

  const binding = parsed.value;
  const providerAccountId = binding.providerAccountId ?? "";
  const saved = await prisma.communicationChannelBinding.upsert({
    where: {
      channelType_providerKey_providerAccountId_externalSubject: {
        channelType: binding.channelType,
        providerKey: binding.providerKey,
        providerAccountId,
        externalSubject: binding.externalSubject,
      },
    },
    create: {
      principalId: binding.principalId,
      employeeProfileId: binding.employeeProfileId ?? null,
      channelType: binding.channelType,
      providerKey: binding.providerKey,
      providerAccountId,
      externalSubject: binding.externalSubject,
      displayLabel: binding.displayLabel ?? null,
      verificationStatus: "pending",
      allowedDirections: ["outbound"],
      allowedUrgencies: [...binding.allowedUrgencies],
      isActive: true,
    },
    update: {
      principalId: binding.principalId,
      employeeProfileId: binding.employeeProfileId ?? null,
      displayLabel: binding.displayLabel ?? null,
      allowedUrgencies: [...binding.allowedUrgencies],
      isActive: true,
      lastError: null,
    },
    select: { bindingId: true },
  });

  return {
    ok: true,
    message: "Communication channel binding saved.",
    bindingId: saved.bindingId,
  };
}

export async function recordCommunicationChannelBindingTest(input: {
  bindingId: string;
  ok: boolean;
  errorMessage?: string;
}): Promise<CommunicationBindingActionResult> {
  const testedAt = new Date();

  await prisma.communicationChannelBinding.update({
    where: { bindingId: input.bindingId },
    data: {
      verificationStatus: input.ok ? "verified" : "failed",
      lastTestedAt: testedAt,
      lastVerifiedAt: input.ok ? testedAt : null,
      lastError: input.ok ? null : input.errorMessage?.trim() || "Channel test failed.",
    },
  });

  return {
    ok: true,
    message: "Communication channel binding test recorded.",
  };
}

function normalizeUrgencies(values: readonly string[]): CommunicationUrgency[] {
  return values.filter((value): value is CommunicationUrgency =>
    (COMMUNICATION_URGENCIES as readonly string[]).includes(value),
  );
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function formatBindingLabel(providerKey: string, externalSubject: string): string {
  const provider = providerKey
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

  return `${provider} ${externalSubject}`.trim();
}
