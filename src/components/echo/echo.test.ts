import { afterEach, describe, expect, test } from "bun:test";

import type { MessageBody } from "../../model";
import { botAxios } from "../../network";
import echo from "./echo";

const originalPost = botAxios.post;

function makeBody(): MessageBody {
    return {
        message_type: "private",
        sub_type: "friend",
        message_id: 10,
        user_id: 42,
        message: [],
        raw_message: "",
        font: 0,
        sender: { user_id: 42, nickname: "Tester", card: "" },
        time: 0,
        self_id: 100,
        post_type: "message",
    };
}

afterEach(() => {
    botAxios.post = originalPost;
});

describe("echo plugin", () => {
    test("preserves reply payload behavior", async () => {
        let payload: unknown;
        botAxios.post = (async (_url: string, data?: unknown) => {
            payload = data;
            return {
                status: 200,
                data: { status: "ok", retcode: 0, data: { message_id: 20 } },
            };
        }) as typeof botAxios.post;

        await echo(makeBody(), { text: "/echo.r hello" });

        expect(payload).toEqual({
            message_type: "private",
            user_id: "42",
            group_id: undefined,
            message: [
                { type: "reply", data: { id: "10" } },
                { type: "text", data: { text: "hello" } },
            ],
            auto_escape: false,
        });
    });
});
