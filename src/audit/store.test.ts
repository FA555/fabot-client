import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditStore } from "./store";

const stores: AuditStore[] = [];
const temporaryDirectories: string[] = [];

function makeStore(): AuditStore {
    const store = new AuditStore(":memory:");
    stores.push(store);
    return store;
}

function addInbound(store: AuditStore, auditId: string, messageId: string, userId: number): void {
    expect(store.createInbound({
        auditId,
        sourceMessageId: messageId,
        selfAccountId: 100,
        chatType: "private",
        chatId: userId,
        actorUserId: userId,
    })).toBe(true);
}

afterEach(() => {
    for (const store of stores.splice(0)) {
        store.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("AuditStore", () => {
    test("deduplicates inbound messages", () => {
        const store = makeStore();
        addInbound(store, "audit-1", "message-1", 1);
        expect(store.createInbound({
            auditId: "audit-2",
            sourceMessageId: "message-1",
            selfAccountId: 100,
            chatType: "private",
            chatId: 1,
            actorUserId: 1,
        })).toBe(false);
    });

    test("migrates a version 1 database", () => {
        const directory = mkdtempSync(join(tmpdir(), "fa-bot-audit-"));
        temporaryDirectories.push(directory);
        const path = join(directory, "audit.sqlite");
        const legacy = new Database(path, { create: true });
        legacy.exec(`
            CREATE TABLE audit_inbound (
                audit_id TEXT PRIMARY KEY,
                source_message_id TEXT NOT NULL,
                self_account_id INTEGER,
                chat_type TEXT,
                chat_id INTEGER,
                actor_user_id INTEGER,
                occurred_at INTEGER NOT NULL,
                received_at INTEGER NOT NULL,
                finished_at INTEGER,
                outcome TEXT NOT NULL,
                matched_plugin TEXT,
                error_code TEXT,
                UNIQUE (self_account_id, source_message_id)
            );
            CREATE TABLE audit_plugin_run (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id TEXT NOT NULL REFERENCES audit_inbound(audit_id) ON DELETE CASCADE,
                plugin_name TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                error_code TEXT,
                excluded INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE audit_outbound (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id TEXT REFERENCES audit_inbound(audit_id) ON DELETE SET NULL,
                plugin_name TEXT,
                source TEXT NOT NULL,
                message_kind TEXT NOT NULL,
                chat_type TEXT NOT NULL,
                chat_id INTEGER,
                reply_to_message_id TEXT,
                text_length INTEGER NOT NULL,
                image_count INTEGER NOT NULL,
                segment_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                napcat_message_id TEXT,
                http_status INTEGER,
                retcode INTEGER,
                duration_ms INTEGER NOT NULL,
                error_code TEXT,
                excluded INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE audit_ai_request (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                audit_id TEXT REFERENCES audit_inbound(audit_id) ON DELETE SET NULL,
                plugin_name TEXT,
                model_key TEXT NOT NULL,
                model TEXT NOT NULL,
                search INTEGER NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                prompt_length INTEGER NOT NULL,
                response_length INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                error_code TEXT,
                excluded INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            PRAGMA user_version = 1;
        `);
        legacy.close();

        const store = new AuditStore(path);
        stores.push(store);
        addInbound(store, "audit-1", "message-1", 1);
        store.excludeInbound("audit-1");
        store.finishInbound("audit-1", "handled", "audit");
        expect(store.getOverview(0).inboundMessages).toBe(0);
    });

    test("aggregates responses separately from outbound messages", () => {
        const store = makeStore();
        addInbound(store, "audit-1", "message-1", 1);
        store.finishInbound("audit-1", "handled", "ai");
        const runId = store.startPluginRun("audit-1", "ai");
        store.finishPluginRun(runId, "succeeded");
        for (const messageId of ["out-1", "out-2"]) {
            store.recordOutbound({
                auditId: "audit-1",
                pluginName: "ai",
                source: "inbound",
                messageKind: "reply",
                chatType: "private",
                chatId: 1,
                textLength: 10,
                imageCount: 0,
                segmentCount: 1,
                status: "succeeded",
                napcatMessageId: messageId,
                durationMs: 5,
            });
        }
        store.recordAiRequest({
            auditId: "audit-1",
            pluginName: "ai",
            modelKey: "test-model",
            model: "provider-model",
            search: false,
            status: "succeeded",
            attempts: 2,
            durationMs: 50,
            promptLength: 20,
            responseLength: 10,
            inputTokens: 4,
            outputTokens: 3,
            totalTokens: 7,
        });

        expect(store.getOverview(0)).toEqual({
            inboundMessages: 1,
            validMessages: 1,
            activeUsers: 1,
            featureActiveUsers: 1,
            featureInvocations: 1,
            respondedMessages: 1,
            outboundMessages: 2,
            aiGenerations: 1,
            aiAnswers: 1,
            pluginFailures: 0,
            deliveryFailures: 0,
            aiFailures: 0,
        });
        expect(store.getPluginStats(0)).toEqual([{
            pluginName: "ai",
            invocations: 1,
            respondedMessages: 1,
            outboundMessages: 2,
            failures: 0,
        }]);
        expect(store.getAiStats(0)).toEqual([{
            modelKey: "test-model",
            requests: 1,
            generations: 1,
            answers: 1,
            failures: 0,
            retries: 1,
            inputTokens: 4,
            outputTokens: 3,
            totalTokens: 7,
            averageDurationMs: 50,
        }]);
    });

    test("includes audit management queries in statistics", () => {
        const store = makeStore();
        addInbound(store, "audit-1", "message-1", 1);
        const runId = store.startPluginRun("audit-1", "audit");
        store.finishPluginRun(runId, "succeeded");
        store.finishInbound("audit-1", "handled", "audit");
        expect(store.getOverview(0).inboundMessages).toBe(1);
        expect(store.getOverview(0).featureInvocations).toBe(1);
        expect(store.getPluginStats(0)).toEqual([{
            pluginName: "audit",
            invocations: 1,
            respondedMessages: 0,
            outboundMessages: 0,
            failures: 0,
        }]);
    });

    test("keeps plugin failure counts consistent without double-counting delivery errors", () => {
        const store = makeStore();
        addInbound(store, "audit-1", "message-1", 1);
        const runId = store.startPluginRun("audit-1", "notify");
        store.recordOutbound({
            auditId: "audit-1",
            pluginName: "notify",
            source: "inbound",
            messageKind: "reply",
            chatType: "private",
            chatId: 1,
            textLength: 5,
            imageCount: 0,
            segmentCount: 2,
            status: "failed",
            durationMs: 5,
            errorCode: "NapCatSendError",
        });
        store.finishPluginRun(runId, "failed", new Error("delivery failed"));
        store.finishInbound("audit-1", "failed", "notify", new Error("delivery failed"));

        expect(store.getOverview(0).pluginFailures).toBe(1);
        expect(store.getOverview(0).deliveryFailures).toBe(1);
        expect(store.getPluginStats(0)[0]?.failures).toBe(1);
    });
});
