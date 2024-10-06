import { Hono } from "hono";

import logger from "./log";
import { isInWhiteList } from "./whitelist";
import type { MessageBody, TextMessageData } from "./model";

import { echo } from "./components/echo";
import handle from "./components/handle/handle";

const app = new Hono();

app.post("/", async c => {
    const body = await c.req.json() as MessageBody;

    if (body.meta_event_type == "heartbeat") {
        logger.info("Heartbeat");
        return c.json({
            msg: "ok"
        });
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

                    if (data.text.startsWith("/echo ")) {
                        echo(body, data);
                        break;
                    }

                    if (handle.acceptMessage(data.text)) {
                        handle(body, data);
                        break;
                    }

                    break;
                default:
                    break;
            }
        }
    }

    return c.json({
        msg: "ok",
    });
})

app.get("/ping", c => {
    let pingMsg = c.req.query().arg || "ping";
    return c.text(pingMsg.replaceAll('i', 'o'));
})

export default {
    port: 55550,
    fetch: app.fetch,
};
