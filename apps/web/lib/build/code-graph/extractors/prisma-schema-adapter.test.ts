import { describe, expect, it } from "vitest";

import { parsePrismaSchema, type PrismaRelationFact } from "./prisma-schema-adapter";

const FIXTURE = `
enum Role {
  admin
  member
}

model User {
  id      String  @id @default(cuid())
  email   String  @unique @map("email_address")
  role    Role    @default(member)
  posts   Post[]
  profile Profile?
  legacy  String? @ignore
  @@map("users")
}

model Profile {
  id     String  @id
  bio    String?
  userId String  @unique
  user   User    @relation(fields: [userId], references: [id])
}

model Post {
  id       String    @id
  title    String
  authorId String
  author   User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  tags     Tag[]
  comments Comment[]
  @@index([authorId])
}

model Tag {
  id    String @id
  name  String
  posts Post[]
  @@ignore
}

model Comment {
  id     String @id
  postId String
  post   Post   @relation(fields: [postId], references: [id])
}
`;

function relation(
  relations: PrismaRelationFact[],
  fromModel: string,
  fieldName: string,
): PrismaRelationFact {
  const found = relations.find((r) => r.fromModel === fromModel && r.fieldName === fieldName);
  if (!found) throw new Error(`relation ${fromModel}.${fieldName} not found`);
  return found;
}

describe("parsePrismaSchema", () => {
  const facts = parsePrismaSchema(FIXTURE);

  it("parses models and mapped table names", () => {
    const names = facts.models.map((m) => m.name).sort();
    expect(names).toEqual(["Comment", "Post", "Profile", "Tag", "User"]);
    expect(facts.models.find((m) => m.name === "User")?.mappedTable).toBe("users");
  });

  it("parses enums and their values", () => {
    const role = facts.enums.find((e) => e.name === "Role");
    expect(role?.values).toEqual(["admin", "member"]);
  });

  it("classifies field kinds, flags, and mapped columns", () => {
    const user = facts.models.find((m) => m.name === "User")!;
    const id = user.fields.find((f) => f.name === "id")!;
    expect(id).toMatchObject({ kind: "scalar", isId: true, hasDefault: true, isRequired: true });

    const email = user.fields.find((f) => f.name === "email")!;
    expect(email).toMatchObject({ kind: "scalar", isUnique: true, mappedColumn: "email_address" });

    const role = user.fields.find((f) => f.name === "role")!;
    expect(role.kind).toBe("enum");

    const posts = user.fields.find((f) => f.name === "posts")!;
    expect(posts).toMatchObject({ kind: "relation", isList: true });
  });

  it("marks field-level and model-level @ignore", () => {
    const user = facts.models.find((m) => m.name === "User")!;
    expect(user.fields.find((f) => f.name === "legacy")?.isIgnored).toBe(true);
    expect(facts.models.find((m) => m.name === "Tag")?.isIgnored).toBe(true);
  });

  it("derives one-to-many / many-to-one cardinality", () => {
    expect(relation(facts.relations, "User", "posts").cardinality).toBe("one-to-many");
    expect(relation(facts.relations, "Post", "author").cardinality).toBe("many-to-one");
  });

  it("derives one-to-one cardinality", () => {
    expect(relation(facts.relations, "User", "profile").cardinality).toBe("one-to-one");
    expect(relation(facts.relations, "Profile", "user").cardinality).toBe("one-to-one");
  });

  it("derives many-to-many cardinality (implicit)", () => {
    expect(relation(facts.relations, "Post", "tags").cardinality).toBe("many-to-many");
    expect(relation(facts.relations, "Tag", "posts").cardinality).toBe("many-to-many");
  });

  it("captures FK fields and references on the owning side", () => {
    const author = relation(facts.relations, "Post", "author");
    expect(author.fkFields).toEqual(["authorId"]);
    expect(author.references).toEqual(["id"]);
  });

  it("detects FK index coverage (@@index, @unique) and FK-without-index", () => {
    // authorId is covered by @@index([authorId]).
    expect(relation(facts.relations, "Post", "author").isFkIndexed).toBe(true);
    // userId is covered because it is @unique.
    expect(relation(facts.relations, "Profile", "user").isFkIndexed).toBe(true);
    // postId has no index and is not unique -> FK without index.
    expect(relation(facts.relations, "Comment", "post").isFkIndexed).toBe(false);
  });

  it("records line anchors for models and fields", () => {
    const user = facts.models.find((m) => m.name === "User")!;
    expect(user.startLine).toBeGreaterThan(0);
    expect(user.endLine).toBeGreaterThan(user.startLine);
    expect(user.fields.every((f) => f.line >= user.startLine)).toBe(true);
  });

  it("is robust to an empty schema", () => {
    expect(parsePrismaSchema("")).toEqual({ models: [], enums: [], relations: [] });
  });
});
