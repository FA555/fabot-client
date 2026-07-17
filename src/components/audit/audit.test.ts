import { describe, expect, test } from "bun:test";

import type { MessageBody } from "../../model";
import audit, { canQueryAudit, getAuditSince, parseAuditCommand } from "./audit";

function makeBody(messageType: "private" | "group", userId: number): MessageBody {
    return {
        message_type: messageType,
        sub_type: "normal",
        message_id: 1,
        group_id: messageType === "group" ? 2 : undefined,
        user_id: userId,
        message: [],
        raw_message: "",
        font: 0,
        sender: { user_id: userId, nickname: "Admin", card: "" },
        time: 0,
        self_id: 100,
        post_type: "message",
    };
}

describe("audit command", () => {
    test("uses all history by default", () => {
        const body = makeBody("private", 591752976);
        expect(audit.acceptMessage("/audit", body)).toBe(true);
        expect(audit.acceptMessage("/auditing", body)).toBe(false);
        const command = parseAuditCommand("/audit");
        expect(command).toEqual({
            report: "overview",
            rangeMs: null,
            rangeLabel: "全部历史",
        });
        expect(getAuditSince(command!)).toBe(0);
    });

    test("parses chained dot options in any order", () => {
        const body = makeBody("private", 591752976);
        expect(audit.acceptMessage("/audit.ai.time(1d)", body)).toBe(true);
        expect(parseAuditCommand("/audit.ai.time(2w)")).toEqual({
            report: "ai",
            rangeMs: 14 * 24 * 60 * 60 * 1000,
            rangeLabel: "2w",
        });
        expect(parseAuditCommand("/audit.time(7d).plugins")).toEqual({
            report: "plugins",
            rangeMs: 7 * 24 * 60 * 60 * 1000,
            rangeLabel: "7d",
        });
        expect(getAuditSince(parseAuditCommand("/audit.time(1d)")!, 2 * 24 * 60 * 60 * 1000))
            .toBe(24 * 60 * 60 * 1000);
    });

    test("rejects old, unknown, duplicate, and conflicting options", () => {
        expect(parseAuditCommand("/audit ai 1d")).toBeNull();
        expect(parseAuditCommand("/audit.time(0d)")).toBeNull();
        expect(parseAuditCommand("/audit.time(1d).time(2d)")).toBeNull();
        expect(parseAuditCommand("/audit.ai.plugins")).toBeNull();
        expect(parseAuditCommand("/audit.unknown")).toBeNull();
    });

    test("allows only super administrators in private chats", () => {
        expect(canQueryAudit(makeBody("private", 591752976))).toBe(true);
        expect(canQueryAudit(makeBody("group", 591752976))).toBe(false);
        expect(canQueryAudit(makeBody("private", 42))).toBe(false);
    });
});
