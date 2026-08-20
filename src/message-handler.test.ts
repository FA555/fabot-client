import { afterEach, describe, expect, test } from "bun:test";

import { AuditStore } from "./audit/store";
import { compilePluginPolicy } from "./access-control";
import { handleMessage } from "./message-handler";
import type { MessageBody } from "./model";
import type { Plugin, RegisteredPlugin } from "./plugin";

const stores: AuditStore[] = [];

function makeBody(messageId = 1): MessageBody {
    return {
        message_type: "private",
        sub_type: "friend",
        message_id: messageId,
        user_id: 42,
        message: [],
        raw_message: "test",
        font: 0,
        sender: { user_id: 42, nickname: "Tester", card: "" },
        time: Math.floor(Date.now() / 1000),
        self_id: 100,
        post_type: "message",
    };
}

function makeGroupBody(messageId: number): MessageBody {
    return {
        ...makeBody(messageId),
        message_type: "group",
        sub_type: "normal",
        group_id: 2,
    };
}

function makePlugin(
    operation: () => void | Promise<void>,
    accepts: Plugin["acceptMessage"] = () => true,
    observe?: Plugin["observeMessage"],
): Plugin {
    const plugin = operation as unknown as Plugin;
    plugin.acceptMessage = accepts;
    plugin.observeMessage = observe;
    return plugin;
}

function makeDependencies(store: AuditStore) {
    return {
        store,
        flatten: async () => ({ text: "test" }),
        isWhitelisted: () => "test",
        getSelfId: () => 100,
    };
}

afterEach(() => {
    for (const store of stores.splice(0)) {
        store.close();
    }
});

describe("handleMessage", () => {
    test("records a plugin invocation and ignores duplicate delivery", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let calls = 0;
        const plugins: RegisteredPlugin[] = [{
            name: "test",
            plugin: makePlugin(() => { calls += 1; }),
        }];
        const dependencies = makeDependencies(store);

        await handleMessage(makeBody(), plugins, dependencies);
        await handleMessage(makeBody(), plugins, dependencies);

        expect(calls).toBe(1);
        expect(store.getOverview(0).featureInvocations).toBe(1);
    });

    test("records plugin failures without replaying non-idempotent work", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let attempts = 0;
        const plugins: RegisteredPlugin[] = [{
            name: "broken",
            plugin: makePlugin(() => {
                attempts += 1;
                throw new Error("broken");
            }),
        }];
        const dependencies = makeDependencies(store);

        await handleMessage(makeBody(2), plugins, dependencies);
        await handleMessage(makeBody(2), plugins, dependencies);

        const overview = store.getOverview(0);
        expect(attempts).toBe(1);
        expect(overview.inboundMessages).toBe(1);
        expect(overview.featureInvocations).toBe(1);
        expect(overview.pluginFailures).toBe(1);
    });

    test("ignores heartbeat, self, and non-whitelisted group messages before auditing", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let calls = 0;
        const plugins: RegisteredPlugin[] = [{
            name: "test",
            plugin: makePlugin(() => { calls += 1; }),
        }];

        await handleMessage({ ...makeBody(3), meta_event_type: "heartbeat" }, plugins, makeDependencies(store));
        await handleMessage({
            ...makeBody(4),
            user_id: 100,
            sender: { user_id: 100, nickname: "Bot", card: "" },
        }, plugins, makeDependencies(store));
        await handleMessage(makeGroupBody(5), plugins, {
            ...makeDependencies(store),
            isWhitelisted: () => null,
        });

        expect(calls).toBe(0);
        expect(store.getOverview(0).inboundMessages).toBe(0);
    });

    test("receives non-whitelisted private messages without exposing them to plugins", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let flattened = 0;
        let acceptanceChecks = 0;
        let observations = 0;
        const plugin = makePlugin(
            () => undefined,
            () => {
                acceptanceChecks += 1;
                return false;
            },
            () => { observations += 1; },
        );

        await handleMessage(makeBody(11), [{ name: "test", plugin }], {
            ...makeDependencies(store),
            flatten: async () => {
                flattened += 1;
                return { text: "test" };
            },
            isWhitelisted: () => null,
        });

        expect(flattened).toBe(1);
        expect(acceptanceChecks).toBe(0);
        expect(observations).toBe(0);
        expect(store.getOverview(0).inboundMessages).toBe(1);
    });

    test("allows an explicitly public private plugin for non-whitelisted users", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let calls = 0;
        const policy = compilePluginPolicy({
            version: 1,
            rules: [{
                id: "public-private-feature",
                match: { chat_type: "private", whitelisted: false },
                plugins: { public: { invoke: true } },
            }],
        }, ["public"]);

        await handleMessage(makeBody(12), [{
            name: "public",
            plugin: makePlugin(() => { calls += 1; }),
        }], {
            ...makeDependencies(store),
            isWhitelisted: () => null,
            pluginPolicy: policy,
        });

        expect(calls).toBe(1);
        expect(store.getOverview(0).featureInvocations).toBe(1);
    });

    test("runs only the first matching plugin", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        const calls: string[] = [];
        const plugins: RegisteredPlugin[] = [
            { name: "first", plugin: makePlugin(() => { calls.push("first"); }) },
            { name: "second", plugin: makePlugin(() => { calls.push("second"); }) },
        ];

        await handleMessage(makeBody(6), plugins, makeDependencies(store));

        expect(calls).toEqual(["first"]);
        expect(store.getPluginStats(0).map(({ pluginName }) => pluginName)).toEqual(["first"]);
    });

    test("runs observers only when no plugin matches", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let observations = 0;
        const observer = makePlugin(
            () => undefined,
            () => false,
            () => { observations += 1; },
        );
        const plugins: RegisteredPlugin[] = [{ name: "observer", plugin: observer }];

        await handleMessage(makeBody(7), plugins, makeDependencies(store));
        expect(observations).toBe(1);

        observer.acceptMessage = () => true;
        await handleMessage(makeBody(8), plugins, makeDependencies(store));
        expect(observations).toBe(1);
    });

    test("skips disabled invocations without changing plugin priority", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        const calls: string[] = [];
        let blockedAcceptanceChecks = 0;
        const plugins: RegisteredPlugin[] = [
            {
                name: "blocked",
                plugin: makePlugin(
                    () => { calls.push("blocked"); },
                    () => {
                        blockedAcceptanceChecks += 1;
                        return true;
                    },
                ),
            },
            { name: "enabled", plugin: makePlugin(() => { calls.push("enabled"); }) },
        ];

        await handleMessage(makeBody(9), plugins, {
            ...makeDependencies(store),
            pluginPolicy: {
                isEnabled: (pluginName, capability) => pluginName !== "blocked" || capability !== "invoke",
            },
        });

        expect(blockedAcceptanceChecks).toBe(0);
        expect(calls).toEqual(["enabled"]);
        expect(store.getPluginStats(0).map(({ pluginName }) => pluginName)).toEqual(["enabled"]);
    });

    test("independently disables plugin observation", async () => {
        const store = new AuditStore(":memory:");
        stores.push(store);
        let observations = 0;
        const observer = makePlugin(
            () => undefined,
            () => false,
            () => { observations += 1; },
        );

        await handleMessage(makeBody(10), [{ name: "observer", plugin: observer }], {
            ...makeDependencies(store),
            pluginPolicy: {
                isEnabled: (_pluginName, capability) => capability !== "observe",
            },
        });

        expect(observations).toBe(0);
        expect(store.getOverview(0).featureInvocations).toBe(0);
    });
});
