import { afterEach, describe, expect, test } from "bun:test";

import { flattenMessage } from "./message-flattener";
import type { MessageBody } from "./model";
import { botAxios } from "./network";

const originalPost = botAxios.post;

function makeBody(message: MessageBody["message"]): MessageBody {
    return {
        message_type: "group",
        sub_type: "normal",
        message_id: 1,
        group_id: 2,
        user_id: 3,
        message,
        raw_message: "",
        font: 0,
        sender: { user_id: 3, nickname: "Alice", card: "群名片" },
        time: 0,
        self_id: 9,
        post_type: "message",
    };
}

afterEach(() => {
    botAxios.post = originalPost;
});

describe("flattenMessage", () => {
    test("keeps flattened segments in their original positions", async () => {
        const data = await flattenMessage(makeBody([
            { type: "text", data: { text: "/ai " } },
            { type: "at", data: { qq: "3" } },
            { type: "image", data: {} },
            { type: "face", data: { raw: { faceText: "[微笑]" } } },
            { type: "mface", data: { summary: "[猫猫]" } },
            { type: "text", data: { text: " 看看" } },
        ]));

        expect(data?.text).toBe('/ai <at qq="3" name="Alice">Alice</at>[图片][微笑][猫猫] 看看');
    });

    test("drops replies so a following command remains readable", async () => {
        let requestCount = 0;
        botAxios.post = (async () => {
            requestCount += 1;
            return { data: { data: {} } };
        }) as typeof botAxios.post;

        const data = await flattenMessage(makeBody([
            { type: "reply", data: { id: "88" } },
            { type: "text", data: { text: "/ai 总结" } },
        ]));

        expect(data?.text).toBe("/ai 总结");
        expect(requestCount).toBe(0);
    });

    test("handles all-member mentions and unknown segment types", async () => {
        const data = await flattenMessage(makeBody([
            { type: "at", data: { qq: "all" } },
            { type: "custom<&", data: {} },
        ]));

        expect(data?.text).toBe('<at target="all">全体成员</at><message type="custom&lt;&amp;">尚不支持此消息类型</message>');
    });

    test("falls back to the numeric user ID when mention lookup fails", async () => {
        botAxios.post = (async () => {
            throw new Error("lookup failed");
        }) as typeof botAxios.post;

        const data = await flattenMessage(makeBody([
            { type: "at", data: { qq: "1234" } },
        ]));

        expect(data?.text).toBe('<at qq="1234">1234</at>');
    });

    test("returns null for empty and reply-only messages", async () => {
        expect(await flattenMessage(makeBody([]))).toBeNull();
        expect(await flattenMessage(makeBody([{ type: "reply", data: { id: 1 } }]))).toBeNull();
    });
});
