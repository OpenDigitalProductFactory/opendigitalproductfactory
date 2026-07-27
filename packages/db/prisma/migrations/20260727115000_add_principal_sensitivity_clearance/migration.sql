-- @migration-safety: data-safe: additive enum and non-null array column carry a public-only default for every existing Principal.
CREATE TYPE "PrincipalSensitivity" AS ENUM (
  'public',
  'internal',
  'confidential',
  'restricted'
);

ALTER TABLE "Principal"
ADD COLUMN "sensitivityClearance" "PrincipalSensitivity"[] NOT NULL
DEFAULT ARRAY['public']::"PrincipalSensitivity"[];
