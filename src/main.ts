import axios from "axios";
import { Hono } from "hono";

import logger from "./log";
import { isInWhiteList } from "./whitelist";
import type { MessageBody, TextMessageData } from "./model";
import type { Plugin } from "./plugin";

import echo from "./components/echo/echo";
import handle from "./components/handle/handle";
import byrbbs from "./components/byrbbs/byrbbs";
import typst from "./components/typst/typst";

const plugins: Plugin[] = [echo, handle, byrbbs, typst];

axios.interceptors.request.use(config => {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${process.env.NAPCAT_TOKEN}`;
    return config;
});

const app = new Hono();
console.log(`Starting server with NAPCAT_TOKEN: ${process.env.NAPCAT_TOKEN}`);

app.post("/", async c => {
    const body = await c.req.json() as MessageBody;

    if (body.meta_event_type == "heartbeat") {
        logger.info("Heartbeat");
        return c.json({ msg: "ok" });
    }

    let name = isInWhiteList(body.message_type, body.group_id || body.user_id);
    if (name) {
        // logger.info(name);
        // logger.info(body.message);
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
