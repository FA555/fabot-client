import axios from "axios";
import { Hono } from "hono";

import logger from "./log";
import { isInWhiteList } from "./whitelist";
import { getLoginUserId, initLoginInfo } from "./login-info";
import type { MessageBody, TextMessageData } from "./model";
import type { Plugin } from "./plugin";

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
import cronComponent from "./components/cron/cron";
import { tasks } from "../config/hardcoded-tasks";

for (const task of tasks) {
    cronComponent.register(task);
}

cronComponent.start();

process.on("SIGINT", () => cronComponent.stop());
process.on("SIGTERM", () => cronComponent.stop());

const plugins: Plugin[] = [help, echo, handle, byrbbs, bilibili, typst, oeis, notify, leetcode, ai];

axios.interceptors.request.use(config => {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${process.env.NAPCAT_TOKEN}`;
    return config;
});

void initLoginInfo();

const app = new Hono();
console.log(`Starting server with NAPCAT_TOKEN: ${process.env.NAPCAT_TOKEN}`);
console.log(`Starting server with AUTH_BASE: ${process.env.AUTH_BASE ?? "not set"}`);
console.log(`Starting server with AUTH_KEY: ${process.env.AUTH_KEY ? "****" : "not set"}`);

app.post("/", async c => {
    const body = await c.req.json() as MessageBody;

    if (body.meta_event_type == "heartbeat") {
        logger.info("Heartbeat");
        return c.json({ msg: "ok" });
    }

    const senderId = body.user_id ?? body.sender?.user_id;
    const selfId = getLoginUserId() ?? body.self_id;
    if (typeof senderId === "number" && senderId === selfId) {
        logger.info(`Ignored self message from login account: ${senderId}`);
        return c.json({ msg: "ok" });
    }

    let name = isInWhiteList(body);
    if (name) {
        // logger.info(name);
        // logger.info(body);
        if (body.message && body.message.length === 1) {
            let message = body.message[0];
            switch (message.type) {
                case "text":
                    let data = message.data as TextMessageData;
                    for (const plugin of plugins) {
                        if (plugin.acceptMessage(data.text)) {
                            await plugin(body, data);
                        }
                    }
                    break;
                default:
                    break;
            }
        }
    }

    return c.json({ msg: "ok" });
})

app.get("/ping", c => {
    let pingMsg = c.req.query().arg || "ping";
    return c.text(pingMsg.replaceAll('i', 'o'));
})

export default {
    port: 55550,
    fetch: app.fetch,
};
