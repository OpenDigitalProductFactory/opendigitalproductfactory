import { WriteGateRequirement } from "@dpf/db";

const providers = [
  { providerKey: "adp", displayName: "ADP Workforce Now", posture: "native", replacementIntent: "augment" },
  { providerKey: "quickbooks", displayName: "QuickBooks Online", posture: "native", replacementIntent: "augment" },
  { providerKey: "stripe", displayName: "Stripe Billing & Payments", posture: "native", replacementIntent: "augment" },
  { providerKey: "microsoft365", displayName: "Microsoft 365 Communications", posture: "native", replacementIntent: "augment" },
  { providerKey: "hubspot", displayName: "HubSpot CRM & Marketing", posture: "native", replacementIntent: "augment" },
  { providerKey: "google-marketing", displayName: "Google Marketing Intelligence", posture: "native", replacementIntent: "augment" },
  { providerKey: "google-business-profile", displayName: "Google Business Profile", posture: "native", replacementIntent: "augment" },
  { providerKey: "facebook-lead-ads", displayName: "Facebook Lead Ads", posture: "native", replacementIntent: "augment" },
  { providerKey: "mailchimp", displayName: "Mailchimp Marketing", posture: "native", replacementIntent: "augment" },
] as const;

const roles = [
  "owner_operator",
  "bookkeeper_accountant",
  "sales_bd",
  "marketer",
  "service_ops",
  "customer_support",
  "hr_payroll_admin",
  "it_security_compliance",
  "inventory_procurement_admin",
] as const;

type IntegrationCoverageSeedClient = {
  integrationCoverageProvider: {
    upsert(args: {
      where: { organizationId_providerKey: { organizationId: string; providerKey: string } };
      update: { displayName: string; posture: string; replacementIntent: string };
      create: {
        organizationId: string;
        providerKey: string;
        displayName: string;
        posture: string;
        replacementIntent: string;
      };
    }): Promise<unknown>;
  };
  integrationRoleCoverage?: {
    upsert(args: {
      where: {
        organizationId_providerKey_role_surface: {
          organizationId: string;
          providerKey: string;
          role: string;
          surface: string;
        };
      };
      update: { readPosture: string; writeGates: WriteGateRequirement[] };
      create: {
        organizationId: string;
        providerKey: string;
        role: string;
        surface: string;
        readPosture: string;
        writeGates: WriteGateRequirement[];
      };
    }): Promise<unknown>;
  };
};

export async function seedIntegrationCoverage(
  prisma: IntegrationCoverageSeedClient,
  organizationId: string,
): Promise<void> {
  for (const provider of providers) {
    await prisma.integrationCoverageProvider.upsert({
      where: {
        organizationId_providerKey: {
          organizationId,
          providerKey: provider.providerKey,
        },
      },
      update: {
        displayName: provider.displayName,
        posture: provider.posture,
        replacementIntent: provider.replacementIntent,
      },
      create: {
        organizationId,
        providerKey: provider.providerKey,
        displayName: provider.displayName,
        posture: provider.posture,
        replacementIntent: provider.replacementIntent,
      },
    });

    if (!prisma.integrationRoleCoverage) {
      continue;
    }

    for (const role of roles) {
      await prisma.integrationRoleCoverage.upsert({
        where: {
          organizationId_providerKey_role_surface: {
            organizationId,
            providerKey: provider.providerKey,
            role,
            surface: "core",
          },
        },
        update: {
          readPosture: "available",
          writeGates: [WriteGateRequirement.credential_verified, WriteGateRequirement.approval_binding],
        },
        create: {
          organizationId,
          providerKey: provider.providerKey,
          role,
          surface: "core",
          readPosture: "available",
          writeGates: [WriteGateRequirement.credential_verified, WriteGateRequirement.approval_binding],
        },
      });
    }
  }
}
