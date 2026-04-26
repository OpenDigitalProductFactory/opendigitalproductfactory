export type AutoMessageDispatchTarget = {
  targetBuildId?: string | null;
  activeBuildId: string | null;
  threadId: string | null;
};

export type AutoMessageSignatureState = {
  signature: string;
  at: number;
} | null;

export function shouldDispatchAutoMessageImmediately({
  targetBuildId,
  activeBuildId,
  threadId,
}: AutoMessageDispatchTarget): boolean {
  if (!targetBuildId) {
    return true;
  }

  return targetBuildId === activeBuildId && threadId != null;
}

export function shouldSuppressAutoMessage(params: {
  last: AutoMessageSignatureState;
  nextSignature: string;
  now: number;
  suppressWindowMs?: number;
}): boolean {
  const { last, nextSignature, now, suppressWindowMs = 750 } = params;
  if (!last) {
    return false;
  }

  return last.signature === nextSignature && now - last.at < suppressWindowMs;
}
