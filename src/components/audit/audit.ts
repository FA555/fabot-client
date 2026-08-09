import { getAuditStore } from "../../audit";
import type { MessageBody, TextMessageData } from "../../model";
import type { Plugin } from "../../plugin";
import { makeTextMessage, sendReplyMessage } from "../../util";
import { isSuperAdmin } from "../../access-control";
import { matchesCommand } from "../../command";

const COMMAND_PREFIX = "/audit";

interface AuditCommand {
    report: "overview" | "plugins" | "ai";
    rangeMs: number | null;
    rangeLabel: string;
}

export function getAuditSince(command: AuditCommand, now = Date.now()): number {
    return command.rangeMs === null ? 0 : now - command.rangeMs;
}

export function canQueryAudit(body: MessageBody): boolean {
    const senderId = body.user_id ?? body.sender?.user_id;
    return body.message_type === "private" && isSuperAdmin(senderId);
}

function acceptsCommand(text: string): boolean {
    return matchesCommand(text, COMMAND_PREFIX, { allowOptions: true });
}

function parseRange(value: string): { milliseconds: number; label: string } | null {
    const match = value.toLowerCase().match(/^(\d+)(h|d|w)$/);
    if (!match) {
        return null;
    }
    const amount = Number(match[1]);
    const unitMs = match[2] === "h"
        ? 60 * 60 * 1000
        : match[2] === "d"
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;
    const milliseconds = amount * unitMs;
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
        return null;
    }
    return { milliseconds, label: `${amount}${match[2]}` };
}

export function parseAuditCommand(text: string): AuditCommand | null {
    const trimmed = text.trim();
    if (trimmed === COMMAND_PREFIX) {
        return { report: "overview", rangeMs: null, rangeLabel: "全部历史" };
    }
    if (!trimmed.startsWith(`${COMMAND_PREFIX}.`)) {
        return null;
    }

    let remainder = trimmed.slice(COMMAND_PREFIX.length);
    let report: AuditCommand["report"] = "overview";
    let reportSpecified = false;
    let range: { milliseconds: number; label: string } | null = null;

    while (remainder) {
        const timeMatch = remainder.match(/^\.time\(([^)]*)\)/i);
        if (timeMatch) {
            if (range) {
                return null;
            }
            range = parseRange(timeMatch[1].trim());
            if (!range) {
                return null;
            }
            remainder = remainder.slice(timeMatch[0].length);
            continue;
        }

        const flagMatch = remainder.match(/^\.(ai|plugins)\b/i);
        if (!flagMatch || reportSpecified) {
            return null;
        }
        report = flagMatch[1].toLowerCase() as AuditCommand["report"];
        reportSpecified = true;
        remainder = remainder.slice(flagMatch[0].length);
    }

    return {
        report,
        rangeMs: range?.milliseconds ?? null,
        rangeLabel: range?.label ?? "全部历史",
    };
}

function usage(): string {
    return [
        "审计命令（仅超级管理员私聊可用）",
        "/audit：全部历史总览",
        "/audit.time(7d)：最近 7 天总览",
        "/audit.plugins.time(7d)：最近 7 天功能明细",
        "/audit.ai.time(1d)：最近 1 天 AI 明细",
        "参数可以链式组合且顺序无关，例如 /audit.time(1d).ai。",
        "时间范围支持 h、d、w。",
    ].join("\n");
}

function formatOverview(rangeLabel: string, since: number): string {
    const stats = getAuditStore().getOverview(since);
    return [
        `审计总览（${rangeLabel}）`,
        `收到消息（白名单）：${stats.inboundMessages}`,
        `有效消息：${stats.validMessages}`,
        `活跃用户：${stats.activeUsers}`,
        `功能活跃用户：${stats.featureActiveUsers}`,
        `功能调用：${stats.featureInvocations}`,
        `回应消息：${stats.respondedMessages}`,
        `发出消息：${stats.outboundMessages}`,
        `AI 生成 / 回答：${stats.aiGenerations} / ${stats.aiAnswers}`,
        `失败（功能 / 投递 / AI）：${stats.pluginFailures} / ${stats.deliveryFailures} / ${stats.aiFailures}`,
    ].join("\n");
}

function formatPlugins(rangeLabel: string, since: number): string {
    const rows = getAuditStore().getPluginStats(since);
    if (rows.length === 0) {
        return `功能审计（${rangeLabel}）\n暂无数据。`;
    }
    return [
        `功能审计（${rangeLabel}）`,
        "格式：调用 / 回应 / 发出 / 失败",
        ...rows.map(row => (
            `${row.pluginName}：${row.invocations} / ${row.respondedMessages} / ${row.outboundMessages} / ${row.failures}`
        )),
    ].join("\n");
}

function formatAi(rangeLabel: string, since: number): string {
    const rows = getAuditStore().getAiStats(since);
    if (rows.length === 0) {
        return `AI 审计（${rangeLabel}）\n暂无 Provider 请求数据。`;
    }
    return [
        `AI 审计（${rangeLabel}）`,
        "格式：请求 / 生成 / 回答 / 失败 / 重试 / 平均耗时",
        ...rows.map(row => (
            `${row.modelKey}：${row.requests} / ${row.generations} / ${row.answers} / ${row.failures} / ${row.retries} / ${row.averageDurationMs}ms`
        )),
        `Token（输入 / 输出 / 总计）：${rows.reduce((sum, row) => sum + row.inputTokens, 0)} / ${rows.reduce((sum, row) => sum + row.outputTokens, 0)} / ${rows.reduce((sum, row) => sum + row.totalTokens, 0)}`,
    ].join("\n");
}

const audit = (async (body: MessageBody, data: TextMessageData) => {
    if (!canQueryAudit(body)) {
        return;
    }

    const command = parseAuditCommand(data.text);
    if (!command) {
        await sendReplyMessage(body, makeTextMessage(usage()));
        return;
    }

    const since = getAuditSince(command);
    const message = command.report === "plugins"
        ? formatPlugins(command.rangeLabel, since)
        : command.report === "ai"
            ? formatAi(command.rangeLabel, since)
            : formatOverview(command.rangeLabel, since);
    await sendReplyMessage(body, makeTextMessage(message));
}) as Plugin;

audit.acceptMessage = acceptsCommand;

export default audit;
