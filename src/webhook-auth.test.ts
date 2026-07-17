import { describe, expect, test } from "bun:test";

import { isWebhookAuthorized } from "./webhook-auth";

describe("isWebhookAuthorized", () => {
    test("allows requests when webhook authentication is disabled", () => {
        expect(isWebhookAuthorized(undefined, undefined)).toBe(true);
    });

    test("requires an exact bearer token when configured", () => {
        expect(isWebhookAuthorized("Bearer secret", "secret")).toBe(true);
        expect(isWebhookAuthorized("Bearer wrong", "secret")).toBe(false);
        expect(isWebhookAuthorized(undefined, "secret")).toBe(false);
    });
});
