import { AuditStore } from "./store";

let defaultStore: AuditStore | undefined;

export function getAuditStore(): AuditStore {
    defaultStore ??= new AuditStore();
    return defaultStore;
}
