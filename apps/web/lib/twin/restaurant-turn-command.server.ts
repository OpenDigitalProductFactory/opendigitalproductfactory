import {
  transitionHospitalityCapacity,
} from "@/lib/storefront/hospitality-capacity-repository.server";
import {
  transitionHospitalityServiceTurnRecord,
} from "@/lib/storefront/hospitality-service-turn-repository.server";
import {
  HospitalityServiceTurnVersionError,
  type HospitalityServiceTurnStage,
} from "@/lib/storefront/hospitality-service-turn";

import type { OperationalCommandResult } from "./operations-command";

export interface RestaurantTurnStageCommand {
  idempotencyKey: string;
  serviceTurnId: string;
  expectedVersion: number;
  stage: HospitalityServiceTurnStage;
}

interface RestaurantTurnRow {
  id: string;
  turnId: string;
  stage: string;
  version: number;
  bookingId: string | null;
}

interface RestaurantTurnTransaction {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  hospitalityServiceTurn: {
    findFirst(args: unknown): Promise<RestaurantTurnRow | null>;
  };
  hospitalityCapacityAllocation: {
    findMany(args: unknown): Promise<Array<{ id: string; version: number }>>;
  };
  storefrontBooking: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

interface RestaurantTurnDatabase {
  $transaction<T>(
    run: (transaction: RestaurantTurnTransaction) => Promise<T>,
  ): Promise<T>;
}

interface RestaurantTurnDependencies {
  transitionTurn(
    database: RestaurantTurnTransaction,
    input: {
      organizationId: string;
      serviceTurnId: string;
      expectedVersion: number;
      stage: HospitalityServiceTurnStage;
      at: Date;
      actorRef: string;
      idempotencyKey: string;
    },
  ): Promise<{
    id: string;
    stage: HospitalityServiceTurnStage;
    version: number;
    replayed: boolean;
  }>;
  transitionCapacity(
    database: RestaurantTurnTransaction,
    input: {
      allocationId: string;
      organizationId: string;
      expectedVersion: number;
      lifecycle: "released";
      at: Date;
      reason: string;
    },
  ): Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: RestaurantTurnDependencies = {
  transitionTurn: (database, input) =>
    transitionHospitalityServiceTurnRecord(database as never, input),
  transitionCapacity: (database, input) =>
    transitionHospitalityCapacity(database as never, input),
};

function rejected(
  command: RestaurantTurnStageCommand,
  reasonCode: string,
  message: string,
): OperationalCommandResult {
  return {
    status: "rejected",
    idempotencyKey: command.idempotencyKey,
    replayed: false,
    reasonCode,
    message,
  };
}

/**
 * Advances the restaurant's authoritative service turn. Closing a turn also
 * releases every table allocation and completes its booking in the same
 * transaction, so the floor cannot show a cleared table as still occupied.
 */
export async function executeRestaurantTurnStageCommand(input: {
  database: RestaurantTurnDatabase;
  organizationId: string;
  actorRef: string;
  command: RestaurantTurnStageCommand;
  dependencies?: Partial<RestaurantTurnDependencies>;
  now?: () => Date;
}): Promise<OperationalCommandResult> {
  const { command } = input;
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(command.idempotencyKey)) {
    return rejected(
      command,
      "invalid-idempotency-key",
      "Use an 8–160 character stable command key.",
    );
  }
  if (!command.serviceTurnId.trim() || command.expectedVersion < 1) {
    return rejected(
      command,
      "invalid-turn-reference",
      "Refresh the floor before changing this table.",
    );
  }
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...input.dependencies,
  };
  const at = input.now?.() ?? new Date();
  const startedAt = performance.now();

  try {
    return await input.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "HospitalityServiceTurn"
        WHERE "id" = ${command.serviceTurnId}
          AND "organizationId" = ${input.organizationId}
        FOR UPDATE
      `;
      const turn = await transaction.hospitalityServiceTurn.findFirst({
        where: {
          id: command.serviceTurnId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          turnId: true,
          stage: true,
          version: true,
          bookingId: true,
        },
      });
      if (!turn) {
        return rejected(
          command,
          "turn-not-found",
          "That table turn no longer exists. Refresh the floor.",
        );
      }

      const next = await dependencies.transitionTurn(transaction, {
        organizationId: input.organizationId,
        serviceTurnId: command.serviceTurnId,
        expectedVersion: command.expectedVersion,
        stage: command.stage,
        at,
        actorRef: input.actorRef,
        idempotencyKey: command.idempotencyKey,
      });

      if (command.stage === "closed" && !next.replayed) {
        const allocations =
          await transaction.hospitalityCapacityAllocation.findMany({
            where: {
              organizationId: input.organizationId,
              serviceTurnId: command.serviceTurnId,
              lifecycle: { in: ["reserved", "active"] },
              conflictQuarantinedAt: null,
            },
            select: { id: true, version: true },
            orderBy: { id: "asc" },
          });
        for (const allocation of allocations) {
          await dependencies.transitionCapacity(transaction, {
            allocationId: allocation.id,
            organizationId: input.organizationId,
            expectedVersion: allocation.version,
            lifecycle: "released",
            at,
            reason: "Restaurant table cleared",
          });
        }
        if (turn.bookingId) {
          await transaction.storefrontBooking.updateMany({
            where: {
              id: turn.bookingId,
              organizationId: input.organizationId,
              status: "seated",
            },
            data: {
              status: "completed",
              hospitalityResourceId: null,
            },
          });
        }
      }

      return {
        status: "confirmed",
        idempotencyKey: command.idempotencyKey,
        replayed: next.replayed,
        latencyMs: Math.max(0, performance.now() - startedAt),
        newVersion: `restaurant-turn:${turn.turnId}:${next.version}`,
        changedFacts: [
          {
            entityId: command.serviceTurnId,
            field: "stage",
            value: command.stage,
          },
        ],
      };
    });
  } catch (error) {
    if (error instanceof HospitalityServiceTurnVersionError) {
      const currentVersion = await input.database.$transaction(
        async (transaction) => {
          const turn = await transaction.hospitalityServiceTurn.findFirst({
            where: {
              id: command.serviceTurnId,
              organizationId: input.organizationId,
            },
            select: { turnId: true, version: true },
          });
          return turn
            ? `restaurant-turn:${turn.turnId}:${turn.version}`
            : `restaurant-turn:unknown:${error.actualVersion}`;
        },
      );
      return {
        status: "conflict",
        idempotencyKey: command.idempotencyKey,
        replayed: false,
        currentVersion,
        changedFacts: [],
        alternatives: [],
      };
    }
    throw error;
  }
}
