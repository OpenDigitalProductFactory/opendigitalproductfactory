import { authHandlers } from "./auth.handlers";
import { opsHandlers } from "./ops.handlers";

export const handlers = [...authHandlers, ...opsHandlers];
