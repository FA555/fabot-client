import { Hono } from "hono";

import logger from "../log";
import type { MessageBody } from "../model";
import type { RegisteredPlugin } from "../plugin";
import { isWebhookAuthorized } from "../webhook-auth";

export interface HttpAppDependencies {
    plugins: RegisteredPlugin[];
    webhookToken: string | null;
    handleMessage: (body: MessageBody, plugins: RegisteredPlugin[]) => Promise<void>;
}

export function createHttpApp(dependencies: HttpAppDependencies): Hono {
    const app = new Hono();

    app.post("/", async c => {
        if (!isWebhookAuthorized(c.req.header("authorization"), dependencies.webhookToken ?? undefined)) {
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

        await dependencies.handleMessage(body, dependencies.plugins);
        return c.json({ msg: "ok" });
    });

    app.get("/ping", c => {
        const pingMessage = c.req.query("arg") || "ping";
        return c.text(pingMessage.replaceAll("i", "o"));
    });

    return app;
}
