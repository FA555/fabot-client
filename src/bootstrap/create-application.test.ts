import { describe, expect, test } from "bun:test";

import { createApplication } from "./create-application";

describe("createApplication", () => {
    test("does not start resources until start is called and closes them once", async () => {
        const events: string[] = [];
        const application = createApplication(
            { hostname: "127.0.0.1", port: 55550, webhookToken: null },
            {
                store: { close: () => { events.push("store.close"); } },
                scheduler: {
                    register: task => { events.push(`register:${task.name}`); },
                    start: () => { events.push("scheduler.start"); },
                    stop: () => { events.push("scheduler.stop"); },
                },
                plugins: [],
                loadPluginPolicy: names => {
                    events.push(`policy.load:${names.join(",")}`);
                    return { isEnabled: () => true };
                },
                loadTasks: async () => [{ name: "test", expression: "* * * * *", operation: () => undefined }],
                initializeLogin: async () => { events.push("login.init"); },
                serve: options => {
                    events.push(`serve:${options.hostname}:${options.port}`);
                    return { stop: async () => { events.push("server.stop"); } };
                },
            },
        );

        expect(events).toEqual([]);
        await application.start();
        await application.start();
        expect(events).toEqual([
            "policy.load:",
            "register:test",
            "scheduler.start",
            "serve:127.0.0.1:55550",
            "login.init",
        ]);

        await application.stop();
        await application.stop();
        expect(events).toEqual([
            "policy.load:",
            "register:test",
            "scheduler.start",
            "serve:127.0.0.1:55550",
            "login.init",
            "scheduler.stop",
            "server.stop",
            "store.close",
        ]);
    });

    test("rolls back started resources when login initialization fails", async () => {
        const events: string[] = [];
        const application = createApplication(
            { hostname: "127.0.0.1", port: 55550, webhookToken: null },
            {
                store: { close: () => { events.push("store.close"); } },
                scheduler: {
                    register: () => undefined,
                    start: () => { events.push("scheduler.start"); },
                    stop: () => { events.push("scheduler.stop"); },
                },
                plugins: [],
                pluginPolicy: { isEnabled: () => true },
                loadTasks: async () => [],
                initializeLogin: async () => {
                    events.push("login.init");
                    throw new Error("login failed");
                },
                serve: () => {
                    events.push("server.start");
                    return { stop: async () => { events.push("server.stop"); } };
                },
            },
        );

        await expect(application.start()).rejects.toThrow("login failed");
        expect(events).toEqual([
            "scheduler.start",
            "server.start",
            "login.init",
            "scheduler.stop",
            "server.stop",
            "store.close",
        ]);
        await expect(application.start()).rejects.toThrow("Application cannot be restarted");
    });
});
