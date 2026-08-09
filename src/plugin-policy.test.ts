import { describe, expect, test } from "bun:test";

import type { MessageBody } from "./model";
import { compilePluginPolicy, loadPluginPolicy } from "./plugin-policy";

function makeBody(
    messageType: "private" | "group",
    chatId: number,
    actorUserId: number,
): MessageBody {
    return {
        message_type: messageType,
        sub_type: messageType === "group" ? "normal" : "friend",
        message_id: 1,
        group_id: messageType === "group" ? chatId : undefined,
        user_id: actorUserId,
        message: [],
        raw_message: "",
        font: 0,
        sender: { user_id: actorUserId, nickname: "Tester", card: "" },
        time: 0,
        self_id: 100,
        post_type: "message",
    };
}

describe("compilePluginPolicy", () => {
    test("applies defaults, plugin modes, and ordered rules", () => {
        const policy = compilePluginPolicy({
            version: 1,
            defaults: { enabled: true },
            plugins: {
                ai: {
                    modes: {
                        private: { observe: false },
                    },
                },
            },
            rules: [
                {
                    id: "disable-ai-in-group",
                    match: { chat_type: "group", chat_ids: [200] },
                    plugins: { ai: { enabled: false } },
                },
                {
                    id: "allow-selected-user",
                    match: { chat_type: "group", chat_ids: [200], actor_user_ids: [42] },
                    plugins: { ai: { invoke: true } },
                },
            ],
        }, ["ai", "echo"]);

        expect(policy.isEnabled("echo", "invoke", makeBody("group", 200, 7))).toBe(true);
        expect(policy.isEnabled("ai", "observe", makeBody("private", 42, 42))).toBe(false);
        expect(policy.isEnabled("ai", "invoke", makeBody("group", 200, 7))).toBe(false);
        expect(policy.isEnabled("ai", "observe", makeBody("group", 200, 42))).toBe(false);
        expect(policy.isEnabled("ai", "invoke", makeBody("group", 200, 42))).toBe(true);
    });

    test("matches super administrators without bypassing other selectors", () => {
        const policy = compilePluginPolicy({
            version: 1,
            rules: [{
                id: "admin-private-only",
                match: { chat_type: "private", super_admin: true },
                plugins: { audit: { invoke: true } },
            }],
            plugins: { audit: { invoke: false } },
        }, ["audit"]);

        expect(policy.isEnabled("audit", "invoke", makeBody("private", 1001, 1001))).toBe(true);
        expect(policy.isEnabled("audit", "invoke", makeBody("group", 2, 1001))).toBe(false);
        expect(policy.isEnabled("audit", "invoke", makeBody("private", 42, 42))).toBe(false);
    });

    test("rejects unknown plugins, duplicate rules, and malformed selectors", () => {
        expect(() => compilePluginPolicy({
            version: 1,
            plugins: { typo: { enabled: false } },
        }, ["ai"])).toThrow("Unknown plugin");

        expect(() => compilePluginPolicy({
            version: 1,
            rules: [
                { id: "same", match: {}, plugins: { ai: { enabled: false } } },
                { id: "same", match: {}, plugins: { ai: { enabled: true } } },
            ],
        }, ["ai"])).toThrow("Duplicate rule ID");

        expect(() => compilePluginPolicy({
            version: 1,

            rules: [{
                id: "bad-id",
                match: { chat_ids: [0] },
                plugins: { ai: { enabled: false } },
            }],
        }, ["ai"])).toThrow("positive integer");
    });

    test("loads the repository default policy", () => {
        const pluginNames = [
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
        ];
        const policy = loadPluginPolicy(pluginNames, "", "config/plugin-policy.yaml");

        expect(policy.isEnabled("ai", "invoke", makeBody("private", 42, 42))).toBe(true);
        expect(policy.isEnabled("ai", "observe", makeBody("private", 42, 42))).toBe(false);
        expect(policy.isEnabled("ai", "observe", makeBody("group", 2, 42))).toBe(true);
    });

    test("fails for a configured missing file but preserves defaults when optional file is absent", () => {
        expect(() => loadPluginPolicy(["ai"], "missing/required-plugin-policy.yaml"))
            .toThrow("Configured plugin policy does not exist");

        const policy = loadPluginPolicy(["ai"], "", "missing/optional-plugin-policy.yaml");
        expect(policy.isEnabled("ai", "invoke", makeBody("private", 42, 42))).toBe(true);
        expect(policy.isEnabled("ai", "observe", makeBody("group", 2, 42))).toBe(true);
    });
});
