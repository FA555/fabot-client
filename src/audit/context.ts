import { AsyncLocalStorage } from "node:async_hooks";

import type { AuditContext } from "./types";

const auditContextStorage = new AsyncLocalStorage<AuditContext>();

export function getAuditContext(): AuditContext | undefined {
    return auditContextStorage.getStore();
}

export function runWithAuditContext<T>(context: AuditContext, operation: () => T): T {
    const current = auditContextStorage.getStore();
    return auditContextStorage.run({ ...current, ...context }, operation);
}
