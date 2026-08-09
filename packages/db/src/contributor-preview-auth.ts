import { hash as hashBcryptPassword } from "bcryptjs";

type PreviewDatabaseClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<Array<{ id: string }>>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type PasswordHasher = (password: string) => Promise<string>;

export const CONTRIBUTOR_PREVIEW_ADMIN_EMAIL = "preview-admin@dpf.test";

export function requireContributorPreviewPassword(
  password: string | undefined,
): string {
  if (!password || password.length < 12) {
    throw new Error(
      "CONTRIBUTOR_PREVIEW_PASSWORD must be set to a development-only password of at least 12 characters",
    );
  }
  return password;
}

export async function provisionContributorPreviewAdmin(
  client: PreviewDatabaseClient,
  password: string,
  hashPassword: PasswordHasher = (value) => hashBcryptPassword(value, 12),
): Promise<void> {
  const users = await client.$queryRawUnsafe(
    `SELECT "id"
       FROM "User"
      WHERE "isActive" = true
        AND "isSuperuser" = true
      ORDER BY "id"
      LIMIT 1`,
  );
  const user = users[0];
  if (!user) {
    throw new Error("Sanitized Contributor preview has no active superuser to provision");
  }

  const passwordHash = await hashPassword(password);
  await client.$executeRawUnsafe(
    `UPDATE "User"
        SET "email" = $1,
            "passwordHash" = $2
      WHERE "id" = $3`,
    CONTRIBUTOR_PREVIEW_ADMIN_EMAIL,
    passwordHash,
    user.id,
  );
  console.log(`[sanitized-clone] Provisioned ${CONTRIBUTOR_PREVIEW_ADMIN_EMAIL} with the development-only preview credential`);
}
