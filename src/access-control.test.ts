import { describe, expect, test } from "bun:test";

import type { MessageBody } from "./model";
import {
    compilePluginPolicy,
    getSuperAdmins,
    isInWhiteList,
    isSuperAdmin,
    loadPluginPolicy,
} from "./access-control";

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

        expect(policy.isEnabled("echo", "invoke", makeBody("group", 200, 7), { whitelisted: true })).toBe(true);
        expect(policy.isEnabled("ai", "observe", makeBody("private", 42, 42), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("ai", "invoke", makeBody("group", 200, 7), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("ai", "observe", makeBody("group", 200, 42), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("ai", "invoke", makeBody("group", 200, 42), { whitelisted: true })).toBe(true);
    });

    test("applies wildcard settings before plugin-specific overrides", () => {
        const policy = compilePluginPolicy({
            version: 1,
            plugins: {
                "*": { enabled: false },
                ai: { enabled: true },
            },
            rules: [{
                id: "only-handle-in-group",
                match: { chat_type: "group", chat_ids: [200] },
                plugins: {
                    "*": { enabled: false },
                    handle: { enabled: true },
                },
            }],
        }, ["ai", "echo", "handle"]);

        expect(policy.isEnabled("echo", "invoke", makeBody("private", 7, 7), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("ai", "invoke", makeBody("private", 7, 7), { whitelisted: true })).toBe(true);
        expect(policy.isEnabled("ai", "invoke", makeBody("group", 200, 7), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("ai", "observe", makeBody("group", 200, 7), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("handle", "invoke", makeBody("group", 200, 7), { whitelisted: true })).toBe(true);
    });

    test("requires an explicit non-whitelisted rule for public private plugins", () => {
        const policy = compilePluginPolicy({
            version: 1,
            defaults: { enabled: true },
            plugins: { public: { enabled: true } },
            rules: [
                {
                    id: "implicit-rule-does-not-open-access",
                    match: { chat_type: "private" },
                    plugins: { private: { invoke: true } },
                },
                {
                    id: "explicit-public-private-access",
                    match: { chat_type: "private", whitelisted: false },
                    plugins: { public: { invoke: true } },
                },
            ],
        }, ["private", "public"]);
        const outsider = { whitelisted: false };
        const body = makeBody("private", 7, 7);

        expect(policy.isEnabled("private", "invoke", body, outsider)).toBe(false);
        expect(policy.isEnabled("public", "observe", body, outsider)).toBe(false);
        expect(policy.isEnabled("public", "invoke", body, outsider)).toBe(true);
    });

    test("treats empty ID selectors as matching no chats", () => {
        const policy = compilePluginPolicy({
            version: 1,
            rules: [{
                id: "not-configured-yet",
                match: { chat_type: "group", chat_ids: [] },
                plugins: { "*": { enabled: false } },
            }],
        }, ["ai"]);

        expect(policy.isEnabled("ai", "invoke", makeBody("group", 200, 7), { whitelisted: true })).toBe(true);
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

        expect(policy.isEnabled("audit", "invoke", makeBody("private", 1001, 1001), { whitelisted: true })).toBe(true);
        expect(policy.isEnabled("audit", "invoke", makeBody("group", 2, 1001), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("audit", "invoke", makeBody("private", 42, 42), { whitelisted: true })).toBe(false);
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

    test("loads identities and plugin policy from the same YAML file", () => {
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
        const policy = loadPluginPolicy(pluginNames);

        expect(isInWhiteList(makeBody("private", 1001, 1001))).toBe("test-admin");
        expect(isInWhiteList(makeBody("group", 2, 42))).toBe("test-group");
        expect(isSuperAdmin(1001)).toBe(true);
        expect(getSuperAdmins()).toEqual([{ name: "test-admin", id: 1001 }]);
        expect(policy.isEnabled("ai", "invoke", makeBody("private", 42, 42), { whitelisted: true })).toBe(true);
        expect(policy.isEnabled("ai", "observe", makeBody("private", 42, 42), { whitelisted: true })).toBe(false);
        expect(policy.isEnabled("ai", "observe", makeBody("group", 2, 42), { whitelisted: true })).toBe(true);
    });

});
