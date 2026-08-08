export type WorkCapsuleActor = {
  userId: string;
  agentId: string | null;
  principalId: string | null;
};

export type CapsuleDb = {
  workCapsule: {
    create(args: unknown): Promise<any>;
    findFirst(args: unknown): Promise<any>;
    findUnique(args: unknown): Promise<any>;
    findMany(args: unknown): Promise<any[]>;
    update(args: unknown): Promise<any>;
  };
  workCapsuleActivity: { create(args: unknown): Promise<any> };
  backlogItem?: {
    findFirst(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
  $transaction?<T>(fn: (tx: CapsuleDb) => Promise<T>): Promise<T>;
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  platformCapability?: { findMany(args: unknown): Promise<any[]> };
  runtimeCapabilityTransition?: { findFirst(args: unknown): Promise<any> };
};
