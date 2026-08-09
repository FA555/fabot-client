import { describe, expect, test } from "bun:test";

import { loadEmergencyConfig } from "./config";

describe("loadEmergencyConfig", () => {
    test("is disabled unless webhook and allowed users are configured", () => {
        expect(loadEmergencyConfig({})).toBeNull();
        expect(loadEmergencyConfig({ EMERGENCY_WEBHOOK_BASE: "https://example.com/key" })).toBeNull();
    });

    test("loads an HTTPS webhook and independent user capability", () => {
        const config = loadEmergencyConfig({
            EMERGENCY_WEBHOOK_BASE: "https://example.com/key/",
            EMERGENCY_ALLOWED_USER_IDS: "42, 1001",
            EMERGENCY_TARGET_USER_ID: "2002",
        });

        expect(config?.webhookBase).toBe("https://example.com/key");
        expect([...config?.allowedUserIds ?? []]).toEqual([42, 1001]);
        expect(config?.targetUserId).toBe(2002);
    });

    test("rejects insecure webhooks and invalid user IDs", () => {
        expect(() => loadEmergencyConfig({
            EMERGENCY_WEBHOOK_BASE: "http://example.com/key",
            EMERGENCY_ALLOWED_USER_IDS: "42",
        })).toThrow("must use HTTPS");
        expect(() => loadEmergencyConfig({
            EMERGENCY_WEBHOOK_BASE: "https://example.com/key",
            EMERGENCY_ALLOWED_USER_IDS: "not-an-id",
        })).toThrow("invalid user ID");
    });
});
