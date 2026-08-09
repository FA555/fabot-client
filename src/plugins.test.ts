import { describe, expect, test } from "bun:test";

import type { MessageBody } from "./model";
import { plugins } from "./plugins";

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

function accepts(pluginName: string, text: string): boolean {
    const registration = plugins.find(({ name }) => name === pluginName);
    if (!registration) {
        throw new Error(`Missing plugin: ${pluginName}`);
    }
    return registration.plugin.acceptMessage(text, body);
}

describe("plugin registry", () => {
    test("keeps the established first-match priority", () => {
        expect(plugins.map(({ name }) => name)).toEqual([
            "audit",
            "help",
            "echo",
            "handle",
            "byrbbs",
            "bilibili",
            "typst",
            "oeis",
            "notify",
            "leetcode",
            "ai",
        ]);
    });

    test("keeps the private-message AI fallback last", () => {
        expect(plugins.at(-1)?.name).toBe("ai");
    });

    test("accepts established dot options", () => {
        expect(accepts("echo", "/echo.r hello")).toBe(true);
        expect(accepts("typst", "/typst.code(cpp) int main() {}" )).toBe(true);
        expect(accepts("ai", "/ai.s latest news")).toBe(true);
    });

    test("rejects command-name prefix collisions", () => {
        expect(accepts("echo", "/echoes hello")).toBe(false);
        expect(accepts("handle", "/handler")).toBe(false);
        expect(accepts("notify", "/emergencyX hello")).toBe(false);
        expect(accepts("leetcode", "/leetcode.extra")).toBe(false);
    });
});
