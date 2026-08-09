import { describe, expect, test } from "bun:test";

import { matchesCommand } from "./command";

describe("matchesCommand", () => {
    test("accepts exact commands and whitespace payloads", () => {
        expect(matchesCommand("/echo", "/echo")).toBe(true);
        expect(matchesCommand("  /echo payload", "/echo")).toBe(true);
        expect(matchesCommand("/echo\tpayload", "/echo")).toBe(true);
    });

    test("accepts dot options only when enabled", () => {
        expect(matchesCommand("/echo.r payload", "/echo", { allowOptions: true })).toBe(true);
        expect(matchesCommand("/echo.r payload", "/echo")).toBe(false);
    });

    test("rejects commands that only share a prefix", () => {
        expect(matchesCommand("/echoes payload", "/echo", { allowOptions: true })).toBe(false);
        expect(matchesCommand("/handler", "/handle", { allowOptions: true })).toBe(false);
        expect(matchesCommand("/emergencyX", "/emergency", { allowOptions: true })).toBe(false);
    });
});
