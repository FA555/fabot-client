import { fileURLToPath } from "node:url";

process.env.WHITELIST_PATH = fileURLToPath(new URL("./fixtures/whitelist.yaml", import.meta.url));
process.env.AUDIT_DB_PATH = ":memory:";
