import { Hono } from "hono";

import logger from "./log";
import { PROXY_ENV_KEYS } from "./network";
import { initLoginInfo } from "./login-info";
import type { MessageBody } from "./model";
import type { RegisteredPlugin } from "./plugin";
import { handleMessage } from "./message-handler";
import { isWebhookAuthorized } from "./webhook-auth";
import { getAuditStore } from "./audit";

import echo from "./components/echo/echo";
import handle from "./components/handle/handle";
import byrbbs from "./components/byrbbs/byrbbs";
import bilibili from "./components/bilibili/bilibili";
import typst from "./components/typst/typst";
import oeis from "./components/oeis/oeis";
import notify from "./components/notify/notify";
import leetcode from "./components/leetcode/leetcode";
import ai from "./components/ai/ai";
import help from "./components/help/help";
import audit from "./components/audit/audit";
import cronComponent from "./components/cron/cron";
import { tasks } from "../config/hardcoded-tasks";

getAuditStore();

for (const task of tasks) {
    cronComponent.register(task);
}

cronComponent.start();

process.on("SIGINT", () => cronComponent.stop());
process.on("SIGTERM", () => cronComponent.stop());

const plugins: RegisteredPlugin[] = [
    { name: "audit", plugin: audit },
    { name: "help", plugin: help },
    { name: "echo", plugin: echo },
    { name: "handle", plugin: handle },
    { name: "bilibili", plugin: bilibili },
    { name: "typst", plugin: typst },
    { name: "oeis", plugin: oeis },
    { name: "notify", plugin: notify },
    { name: "leetcode", plugin: leetcode },
    { name: "ai", plugin: ai },
];

void initLoginInfo();

const app = new Hono();
console.log(`Starting server with NAPCAT_TOKEN: ${process.env.NAPCAT_TOKEN ? "****" : "not set"}`);
console.log(`Starting server with WEBHOOK_TOKEN: ${process.env.WEBHOOK_TOKEN ? "****" : "not set"}`);
console.log(`Starting server with AUTH_BASE: ${process.env.AUTH_BASE ? "****" : "not set"}`);
console.log(`Starting server with AUTH_KEY: ${process.env.AUTH_KEY ? "****" : "not set"}`);
logProxyConfig();

function redactProxyUrl(value: string): string {
    try {
        const url = new URL(value);
        if (url.username || url.password) {
            url.username = "****";
            url.password = "";
        }
        return url.toString();
    } catch {
        return value;
    }
}

function logProxyConfig(): void {
    const entries = PROXY_ENV_KEYS
        .map(key => {
            const raw = process.env[key];
            return [key, raw ? redactProxyUrl(raw) : undefined] as const;
        })
        .filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
        console.log("Starting server with proxy env: none");
        return;
    }

    console.log("Starting server with proxy env:");
    for (const [key, value] of entries) {
        console.log(`  ${key}=${value}`);
    }
}

app.post("/", async c => {
    if (!isWebhookAuthorized(c.req.header("authorization"))) {
        logger.warn("Rejected unauthorized webhook request");
        return c.json({ msg: "unauthorized" }, 401);
    }

    let body: MessageBody;
    try {
        body = await c.req.json() as MessageBody;
    } catch (error) {
        logger.warn({ error }, "Rejected invalid webhook JSON");
        return c.json({ msg: "invalid JSON" }, 400);
    }

    await handleMessage(body, plugins);
    return c.json({ msg: "ok" });
})

app.get("/ping", c => {
    let pingMsg = c.req.query().arg || "ping";
    return c.text(pingMsg.replaceAll('i', 'o'));
})

export default {
    hostname: process.env.BOT_HOST?.trim() || "127.0.0.1",
    port: 55550,
    fetch: app.fetch,
};
