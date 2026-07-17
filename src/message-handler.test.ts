import { afterEach, describe, expect, test } from "bun:test";

import { AuditStore } from "./audit/store";
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

function makePlugin(operation: () => void | Promise<void>): Plugin {
    const plugin = operation as unknown as Plugin;
    plugin.acceptMessage = () => true;
    return plugin;
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
        const dependencies = {
            store,
            flatten: async () => ({ text: "test" }),
            isWhitelisted: () => "test",
            getSelfId: () => 100,
        };

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
        const dependencies = {
            store,
            flatten: async () => ({ text: "test" }),
            isWhitelisted: () => "test",
            getSelfId: () => 100,
        };

        await handleMessage(makeBody(2), plugins, dependencies);
        await handleMessage(makeBody(2), plugins, dependencies);

        const overview = store.getOverview(0);
        expect(attempts).toBe(1);
        expect(overview.inboundMessages).toBe(1);
        expect(overview.featureInvocations).toBe(1);
        expect(overview.pluginFailures).toBe(1);
    });
});
