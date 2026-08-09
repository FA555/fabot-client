import { describe, expect, test } from "bun:test";

import type { MessageBody } from "../model";
import { createHttpApp } from "./http-app";

const body: MessageBody = {
    message_type: "private",
    sub_type: "friend",
    message_id: 1,
    user_id: 42,
    message: [],
    raw_message: "",
    font: 0,
    sender: { user_id: 42, nickname: "Tester", card: "" },
    time: 0,
    self_id: 100,
    post_type: "message",
};

describe("createHttpApp", () => {
    test("authenticates and dispatches webhook messages", async () => {
        const received: MessageBody[] = [];
        const app = createHttpApp({
            plugins: [],
            webhookToken: "secret",
            handleMessage: async message => { received.push(message); },
        });

        const unauthorized = await app.request("/", { method: "POST", body: JSON.stringify(body) });
        expect(unauthorized.status).toBe(401);

        const accepted = await app.request("/", {
            method: "POST",
            headers: { authorization: "Bearer secret", "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        expect(accepted.status).toBe(200);
        expect(received).toEqual([body]);
    });

    test("rejects invalid JSON", async () => {
        const app = createHttpApp({
            plugins: [],
            webhookToken: null,
            handleMessage: async () => undefined,
        });
        const response = await app.request("/", { method: "POST", body: "{" });
        expect(response.status).toBe(400);
    });

    test("keeps the ping endpoint", async () => {
        const app = createHttpApp({
            plugins: [],
            webhookToken: null,
            handleMessage: async () => undefined,
        });
        const response = await app.request("/ping?arg=ping");
        expect(await response.text()).toBe("pong");
    });
});
