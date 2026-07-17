import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { chmodSync, existsSync, mkdirSync } from "node:fs";

import logger from "../log";
import type {
    AiRequestInput,
    AiStats,
    AuditOverview,
    InboundEventInput,
    InboundOutcome,
    OutboundDeliveryInput,
    PluginStats,
} from "./types";

interface CountRow {
    count: number;
}

interface PluginStatsRow {
    plugin_name: string;
    invocations: number;
    responded_messages: number;
    outbound_messages: number;
    failures: number;
}

interface AiStatsRow {
    model_key: string;
    requests: number;
    generations: number;
    answers: number;
    failures: number;
    retries: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    average_duration_ms: number;
}

const DEFAULT_DATABASE_PATH = "data/audit.sqlite";

function toSqliteTimestamp(unixSeconds?: number): number {
    return unixSeconds ? unixSeconds * 1000 : Date.now();
}

function toInteger(value: boolean): number {
    return value ? 1 : 0;
}

function errorCode(error: unknown): string {
    if (error instanceof Error && error.name) {
        return error.name.slice(0, 100);
    }
    return "UnknownError";
}

export class AuditStore {
    private readonly db: Database;

    constructor(path = process.env.AUDIT_DB_PATH?.trim() || DEFAULT_DATABASE_PATH) {
        if (path !== ":memory:") {
            mkdirSync(dirname(path), { recursive: true });
        }
        this.db = new Database(path, { create: true, strict: true });
        if (path !== ":memory:") {
            chmodSync(path, 0o600);
        }
        this.migrate();
        if (path !== ":memory:") {
            for (const file of [path, `${path}-wal`, `${path}-shm`]) {
                if (existsSync(file)) {
                    chmodSync(file, 0o600);
                }
            }
        }
    }

    close(): void {
        this.db.close();
    }

    createInbound(input: InboundEventInput): boolean {
        try {
            const result = this.db.query(`
                INSERT OR IGNORE INTO audit_inbound (
                    audit_id, source_message_id, self_account_id, chat_type, chat_id,
                    actor_user_id, occurred_at, received_at, outcome
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received')
            `).run(
                input.auditId,
                input.sourceMessageId,
                input.selfAccountId ?? null,
                input.chatType ?? null,
                input.chatId ?? null,
                input.actorUserId ?? null,
                toSqliteTimestamp(input.occurredAt),
                Date.now(),
            );
            return result.changes > 0;
        } catch (error) {
            this.logWriteFailure(error, "create inbound audit event");
            return true;
        }
    }

    finishInbound(auditId: string, outcome: InboundOutcome, matchedPlugin?: string, error?: unknown): void {
        try {
            this.db.query(`
                UPDATE audit_inbound
                SET outcome = ?, matched_plugin = ?, finished_at = ?, error_code = ?
                WHERE audit_id = ?
            `).run(outcome, matchedPlugin ?? null, Date.now(), error ? errorCode(error) : null, auditId);
        } catch (writeError) {
            this.logWriteFailure(writeError, "finish inbound audit event");
        }
    }

    excludeInbound(auditId: string): void {
        try {
            this.db.query("UPDATE audit_inbound SET excluded = 1 WHERE audit_id = ?").run(auditId);
        } catch (error) {
            this.logWriteFailure(error, "exclude inbound audit event");
        }
    }

    startPluginRun(auditId: string, pluginName: string, excluded = false): number | null {
        try {
            const result = this.db.query(`
                INSERT INTO audit_plugin_run (audit_id, plugin_name, status, started_at, excluded)
                VALUES (?, ?, 'started', ?, ?)
            `).run(auditId, pluginName, Date.now(), toInteger(excluded));
            return Number(result.lastInsertRowid);
        } catch (error) {
            this.logWriteFailure(error, "start plugin audit run");
            return null;
        }
    }

    finishPluginRun(runId: number | null, status: "succeeded" | "failed", error?: unknown): void {
        if (runId === null) {
            return;
        }
        try {
            this.db.query(`
                UPDATE audit_plugin_run
                SET status = ?, finished_at = ?, error_code = ?
                WHERE id = ?
            `).run(status, Date.now(), error ? errorCode(error) : null, runId);
        } catch (writeError) {
            this.logWriteFailure(writeError, "finish plugin audit run");
        }
    }

    recordOutbound(input: OutboundDeliveryInput): void {
        try {
            this.db.query(`
                INSERT INTO audit_outbound (
                    audit_id, plugin_name, source, message_kind, chat_type, chat_id,
                    reply_to_message_id, text_length, image_count, segment_count, status,
                    napcat_message_id, http_status, retcode, duration_ms, error_code,
                    excluded, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                input.auditId ?? null,
                input.pluginName ?? null,
                input.source,
                input.messageKind,
                input.chatType,
                input.chatId ?? null,
                input.replyToMessageId ?? null,
                input.textLength,
                input.imageCount,
                input.segmentCount,
                input.status,
                input.napcatMessageId ?? null,
                input.httpStatus ?? null,
                input.retcode ?? null,
                input.durationMs,
                input.errorCode ?? null,
                toInteger(Boolean(input.excludeFromStats)),
                Date.now(),
            );
        } catch (error) {
            this.logWriteFailure(error, "record outbound audit event");
        }
    }

    recordAiRequest(input: AiRequestInput): void {
        try {
            this.db.query(`
                INSERT INTO audit_ai_request (
                    audit_id, plugin_name, model_key, model, search, status, attempts,
                    duration_ms, prompt_length, response_length, input_tokens, output_tokens,
                    total_tokens, error_code, excluded, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                input.auditId ?? null,
                input.pluginName ?? null,
                input.modelKey,
                input.model,
                toInteger(input.search),
                input.status,
                input.attempts,
                input.durationMs,
                input.promptLength,
                input.responseLength ?? null,
                input.inputTokens ?? null,
                input.outputTokens ?? null,
                input.totalTokens ?? null,
                input.errorCode ?? null,
                toInteger(Boolean(input.excludeFromStats)),
                Date.now(),
            );
        } catch (error) {
            this.logWriteFailure(error, "record AI audit event");
        }
    }

    getOverview(since: number): AuditOverview {
        const scalar = (sql: string): number => this.db.query<CountRow, [number]>(sql).get(since)?.count ?? 0;
        return {
            inboundMessages: scalar(`
                SELECT COUNT(*) AS count FROM audit_inbound
                WHERE received_at >= ? AND outcome != 'ignored_self' AND excluded = 0
            `),
            validMessages: scalar(`
                SELECT COUNT(*) AS count FROM audit_inbound
                WHERE received_at >= ? AND excluded = 0
                  AND outcome NOT IN ('ignored_self', 'not_whitelisted', 'empty')
            `),
            activeUsers: scalar(`
                SELECT COUNT(DISTINCT actor_user_id) AS count FROM audit_inbound
                WHERE received_at >= ? AND actor_user_id IS NOT NULL AND excluded = 0
                  AND outcome NOT IN ('ignored_self', 'not_whitelisted', 'empty')
            `),
            featureActiveUsers: scalar(`
                SELECT COUNT(DISTINCT i.actor_user_id) AS count
                FROM audit_inbound i JOIN audit_plugin_run p ON p.audit_id = i.audit_id
                WHERE p.started_at >= ? AND p.excluded = 0 AND i.actor_user_id IS NOT NULL
            `),
            featureInvocations: scalar(`
                SELECT COUNT(*) AS count FROM audit_plugin_run WHERE started_at >= ? AND excluded = 0
            `),
            respondedMessages: scalar(`
                SELECT COUNT(DISTINCT audit_id) AS count FROM audit_outbound
                WHERE created_at >= ? AND status = 'succeeded' AND excluded = 0
                  AND source = 'inbound' AND audit_id IS NOT NULL
            `),
            outboundMessages: scalar(`
                SELECT COUNT(*) AS count FROM audit_outbound
                WHERE created_at >= ? AND status = 'succeeded' AND excluded = 0 AND source != 'cron'
            `),
            aiGenerations: scalar(`
                SELECT COUNT(*) AS count FROM audit_ai_request
                WHERE created_at >= ? AND status = 'succeeded' AND excluded = 0
            `),
            aiAnswers: scalar(`
                SELECT COUNT(DISTINCT a.audit_id) AS count
                FROM audit_ai_request a JOIN audit_outbound o ON o.audit_id = a.audit_id
                WHERE a.created_at >= ? AND a.status = 'succeeded' AND a.excluded = 0
                  AND o.status = 'succeeded' AND o.plugin_name = 'ai' AND o.excluded = 0
            `),
            pluginFailures: scalar(`
                SELECT COUNT(*) AS count FROM audit_plugin_run
                WHERE started_at >= ? AND status = 'failed' AND excluded = 0
            `),
            deliveryFailures: scalar(`
                SELECT COUNT(*) AS count FROM audit_outbound
                WHERE created_at >= ? AND status = 'failed' AND excluded = 0 AND source != 'cron'
            `),
            aiFailures: scalar(`
                SELECT COUNT(*) AS count FROM audit_ai_request
                WHERE created_at >= ? AND status = 'failed' AND excluded = 0
            `),
        };
    }

    getPluginStats(since: number): PluginStats[] {
        const rows = this.db.query<PluginStatsRow, [number, number, number, number]>(`
            WITH runs AS (
                SELECT
                    plugin_name,
                    COUNT(*) AS invocations
                FROM audit_plugin_run
                WHERE started_at >= ? AND excluded = 0
                GROUP BY plugin_name
            ), deliveries AS (
                SELECT
                    plugin_name,
                    COUNT(DISTINCT CASE WHEN status = 'succeeded' THEN audit_id END) AS responded_messages,
                    SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS outbound_messages
                FROM audit_outbound
                WHERE created_at >= ? AND excluded = 0 AND source != 'cron' AND plugin_name IS NOT NULL
                GROUP BY plugin_name
            ), failures AS (
                SELECT plugin_name, COUNT(*) AS failures
                FROM (
                    SELECT 'plugin-run:' || id AS failure_key, plugin_name
                    FROM audit_plugin_run
                    WHERE started_at >= ? AND status = 'failed' AND excluded = 0
                    UNION ALL
                    SELECT 'outbound:' || o.id AS failure_key, o.plugin_name
                    FROM audit_outbound o
                    WHERE o.created_at >= ? AND o.status = 'failed' AND o.excluded = 0
                      AND o.source != 'cron' AND o.plugin_name IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM audit_plugin_run p
                          WHERE p.audit_id = o.audit_id AND p.plugin_name = o.plugin_name
                            AND p.status = 'failed'
                      )
                )
                GROUP BY plugin_name
            ), plugins AS (
                SELECT plugin_name FROM runs
                UNION
                SELECT plugin_name FROM deliveries
            )
            SELECT
                p.plugin_name,
                COALESCE(r.invocations, 0) AS invocations,
                COALESCE(d.responded_messages, 0) AS responded_messages,
                COALESCE(d.outbound_messages, 0) AS outbound_messages,
                COALESCE(f.failures, 0) AS failures
            FROM plugins p
            LEFT JOIN runs r ON r.plugin_name = p.plugin_name
            LEFT JOIN deliveries d ON d.plugin_name = p.plugin_name
            LEFT JOIN failures f ON f.plugin_name = p.plugin_name
            ORDER BY invocations DESC, p.plugin_name ASC
        `).all(since, since, since, since);
        return rows.map(row => ({
            pluginName: row.plugin_name,
            invocations: row.invocations,
            respondedMessages: row.responded_messages,
            outboundMessages: row.outbound_messages,
            failures: row.failures,
        }));
    }

    getAiStats(since: number): AiStats[] {
        const rows = this.db.query<AiStatsRow, [number]>(`
            SELECT
                a.model_key,
                COUNT(*) AS requests,
                SUM(CASE WHEN a.status = 'succeeded' THEN 1 ELSE 0 END) AS generations,
                COUNT(DISTINCT CASE WHEN a.status = 'succeeded' AND EXISTS (
                    SELECT 1 FROM audit_outbound o
                    WHERE o.audit_id = a.audit_id AND o.plugin_name = 'ai'
                      AND o.status = 'succeeded' AND o.excluded = 0
                ) THEN a.audit_id END) AS answers,
                SUM(CASE WHEN a.status = 'failed' THEN 1 ELSE 0 END) AS failures,
                SUM(CASE WHEN a.attempts > 1 THEN a.attempts - 1 ELSE 0 END) AS retries,
                COALESCE(SUM(a.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(a.output_tokens), 0) AS output_tokens,
                COALESCE(SUM(a.total_tokens), 0) AS total_tokens,
                CAST(AVG(a.duration_ms) AS INTEGER) AS average_duration_ms
            FROM audit_ai_request a
            WHERE a.created_at >= ? AND a.excluded = 0
            GROUP BY a.model_key
            ORDER BY requests DESC, a.model_key ASC
        `).all(since);
        return rows.map(row => ({
            modelKey: row.model_key,
            requests: row.requests,
            generations: row.generations,
            answers: row.answers,
            failures: row.failures,
            retries: row.retries,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            averageDurationMs: row.average_duration_ms,
        }));
    }

    private migrate(): void {
        this.db.exec("PRAGMA busy_timeout = 5000;");
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA foreign_keys = ON;");
        const migrate = this.db.transaction(() => {
            const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
            if (version >= 2) {
                return;
            }

            if (version === 0) {
                this.db.exec(`
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
                    excluded INTEGER NOT NULL DEFAULT 0,
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

                CREATE INDEX audit_inbound_received_idx ON audit_inbound(received_at);
                CREATE INDEX audit_inbound_actor_idx ON audit_inbound(actor_user_id, received_at);
                CREATE INDEX audit_plugin_run_time_idx ON audit_plugin_run(started_at, plugin_name);
                CREATE INDEX audit_outbound_time_idx ON audit_outbound(created_at, status);
                CREATE INDEX audit_outbound_audit_idx ON audit_outbound(audit_id, plugin_name);
                CREATE INDEX audit_ai_request_time_idx ON audit_ai_request(created_at, model_key);
                PRAGMA user_version = 2;
            `);
                return;
            }

            this.db.exec(`
                ALTER TABLE audit_inbound ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;
                PRAGMA user_version = 2;
            `);
        });
        migrate.immediate();
    }

    private logWriteFailure(error: unknown, operation: string): void {
        logger.error({ error, operation }, "Audit storage operation failed");
    }
}
