// apps/web/lib/tak/prompt-boundary.ts

/**
 * Marker placed between the STATIC (cacheable) and DYNAMIC (per-turn) halves of
 * an assembled system prompt.
 *
 * Kept in its own dependency-free module so the routing layer
 * (chat-adapter -> anthropic-cache) can split on it WITHOUT importing the full
 * prompt assembler — assembleSystemPrompt pulls in DB/Prisma loaders, which must
 * not leak into the inference request path or its unit tests (BI-79A5C00F).
 *
 * The marker is an HTML comment, invisible to the model. Providers that support
 * prompt caching use it to attach a cache breakpoint to the stable prefix.
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n\n<!-- DYNAMIC_BOUNDARY -->\n\n";
