import { describe, expect, test } from "bun:test";

import type { MessageBody } from "../../model";
import ai from "./ai";

function makeGroupBody(selfId: number): MessageBody {
    return {
        message_type: "group",
        sub_type: "normal",
        message_id: 1,
        group_id: 2,
        user_id: 3,
        message: [],
        raw_message: "",
        font: 0,
        sender: { user_id: 3, nickname: "Alice", card: "" },
        time: 0,
        self_id: selfId,
        post_type: "message",
    };
}

describe("AI message acceptance", () => {
    test("accepts a group message beginning with an at for the bot", () => {
        const body = makeGroupBody(1469151662);
        expect(ai.acceptMessage('<at qq="1469151662" name="田园猫">田园猫</at> 你好', body)).toBe(true);
    });

    test("rejects an at for another account and an empty bot at", () => {
        const body = makeGroupBody(1469151662);
        expect(ai.acceptMessage('<at qq="123" name="其他人">其他人</at> 你好', body)).toBe(false);
        expect(ai.acceptMessage('<at qq="1469151662" name="田园猫">田园猫</at>', body)).toBe(false);
    });
});
