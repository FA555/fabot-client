import { describe, expect, test } from "bun:test";

import { getNapCatMessageId } from "./util";

describe("getNapCatMessageId", () => {
    test("returns a successful NapCat message ID", () => {
        expect(getNapCatMessageId({ status: "ok", retcode: 0, data: { message_id: 123 } })).toBe(123);
    });

    test("rejects HTTP-successful business failures", () => {
        expect(() => getNapCatMessageId({ status: "failed", retcode: 100, data: {} })).toThrow("retcode 100");
        expect(() => getNapCatMessageId({ status: "ok", retcode: 0, data: {} })).toThrow("missing message_id");
    });
});
