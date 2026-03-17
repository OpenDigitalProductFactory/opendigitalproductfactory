import { prisma } from "@dpf/db";

type ValidationResult =
  | { status: "no-service" }
  | { status: "validated"; latitude: number; longitude: number }
  | { status: "suggestions"; suggestions: string[] }
  | { status: "error"; message: string };

export async function validateAddress(
  addressId: string,
): Promise<ValidationResult> {
  // Check if a geocoding MCP service is registered
  const geocodingService = await prisma.modelProvider.findFirst({
    where: {
      endpointType: "service",
      status: "active",
      OR: [
        { name: { contains: "geocod", mode: "insensitive" } },
        { name: { contains: "places", mode: "insensitive" } },
        { name: { contains: "mapbox", mode: "insensitive" } },
      ],
    },
  });

  if (!geocodingService) {
    return { status: "no-service" };
  }

  // Load address with hierarchy
  const address = await prisma.address.findUnique({
    where: { id: addressId },
    include: {
      city: { include: { region: { include: { country: true } } } },
    },
  });

  if (!address) return { status: "error", message: "Address not found" };

  // TODO: When a geocoding MCP service is registered, the callProvider
  // infrastructure will be used to make the validation API call.
  // On success, update: validatedAt, validationSource, latitude, longitude
  return { status: "no-service" }; // Placeholder
}
