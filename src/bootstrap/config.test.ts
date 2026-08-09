import { describe, expect, test } from "bun:test";

import { loadAppConfig } from "./config";

describe("loadAppConfig", () => {
    test("uses a loopback-only default listener", () => {
        expect(loadAppConfig({})).toEqual({
            hostname: "127.0.0.1",
            port: 55550,
            webhookToken: null,
        });
    });

    test("requires webhook authentication for external listeners", () => {
        expect(() => loadAppConfig({ BOT_HOST: "0.0.0.0" })).toThrow("WEBHOOK_TOKEN is required");
        expect(loadAppConfig({ BOT_HOST: "0.0.0.0", WEBHOOK_TOKEN: "secret" })).toEqual({
            hostname: "0.0.0.0",
            port: 55550,
            webhookToken: "secret",
        });
    });

    test("rejects invalid ports", () => {
        expect(() => loadAppConfig({ BOT_PORT: "0" })).toThrow("BOT_PORT");
        expect(() => loadAppConfig({ BOT_PORT: "not-a-port" })).toThrow("BOT_PORT");
        expect(() => loadAppConfig({ BOT_PORT: "65536" })).toThrow("BOT_PORT");
    });
});
