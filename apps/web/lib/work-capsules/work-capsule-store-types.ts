export type WorkCapsuleActor = {
  userId: string;
  agentId: string | null;
  principalId: string | null;
};

export type CapsuleDb = {
  workroom: {
    create(args: unknown): Promise<any>;
    findFirst(args: unknown): Promise<any>;
    findUnique(args: unknown): Promise<any>;
    findMany(args: unknown): Promise<any[]>;
    update(args: unknown): Promise<any>;
  };
  workroomActivity: {
    create(args: unknown): Promise<any>;
    findFirst?(args: unknown): Promise<any>;
  };
  backlogItem?: {
    findFirst(args: unknown): Promise<any>;
    findUnique?(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
  backlogItemActivity?: {
    count(args: unknown): Promise<number>;
    findMany(args: unknown): Promise<any[]>;
    create(args: unknown): Promise<any>;
  };
  $transaction?<T>(fn: (tx: CapsuleDb) => Promise<T>): Promise<T>;
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  featureBuild?: { findMany(args: unknown): Promise<any[]> };
  nonProductionEnvironmentLease?: { findMany(args: unknown): Promise<any[]> };
  platformCapability?: { findMany(args: unknown): Promise<any[]> };
  runtimeCapabilityTransition?: { findFirst(args: unknown): Promise<any> };
  agentToolGrant?: { findMany(args: unknown): Promise<any[]> };
};
