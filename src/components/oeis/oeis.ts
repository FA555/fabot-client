import type { MessageBody, TextMessageData } from "../../model";
import type { Plugin } from "../../plugin";
import { makeTextMessage, sendMessage, sendReplyMessage } from "../../util";
import logger from "../../log";

interface OeisInvocation {
    query: string;
    limit: number;
    help: boolean;
    hasExplicitLimit: boolean;
}

interface OeisItem {
    number?: number;
    id?: string;
    name?: string;
}

const COMMAND_PREFIX = "/oeis";
const DEFAULT_RESULTS = 5;
const FIRST_DEFAULT_RESULTS = 1;
const HARD_MAX_RESULTS = 20;

function acceptsCommand(text: string): boolean {
    return text.trimStart().startsWith(COMMAND_PREFIX);
}

function parseInvocation(text: string): OeisInvocation | null {
    if (!acceptsCommand(text)) {
        return null;
    }

    let remainder = text.trimStart().slice(COMMAND_PREFIX.length).trimStart();
    if (!remainder) {
        return null;
    }

    let limit = DEFAULT_RESULTS;
    let help = false;
    let hasExplicitLimit = false;

    while (remainder.startsWith(".")) {
        const token = remainder.match(/^(\S+)/);
        if (!token) {
            break;
        }

        const rawToken = token[1];
        const normalized = rawToken.toLowerCase();
        if (normalized === ".h" || normalized === ".help") {
            help = true;
            remainder = remainder.slice(rawToken.length).trimStart();
            continue;
        }

        const firstMatch = rawToken.match(/^\.(?:f|first)(?:\((\d+)\))?$/i);
        if (!firstMatch) {
            break;
        }

        remainder = remainder.slice(rawToken.length).trimStart();
        hasExplicitLimit = true;
        const maybeLimit = firstMatch[1];
        if (maybeLimit) {
            const parsedLimit = Number.parseInt(maybeLimit, 10);
            limit = Math.max(1, Math.min(parsedLimit, HARD_MAX_RESULTS));
        } else {
            limit = FIRST_DEFAULT_RESULTS;
        }
    }

    const query = remainder.trim();
    if (!query && !help) {
        return null;
    }

    if (!hasExplicitLimit && /^A\d{1,6}$/i.test(query)) {
        limit = FIRST_DEFAULT_RESULTS;
    }

    return { query, limit, help, hasExplicitLimit };
}

const sendHelpMessage = async (body: MessageBody) => {
    type Option = { short?: string, long: string, description: string };

    const options: Option[] = [
        { short: ".f", long: ".first(n)", description: "仅显示前 n 条结果；不写 n 时默认为 1" },
        { short: ".h", long: ".help", description: "显示此帮助信息" },
    ];
    const getOptionLength = (o: Option) => (o.short ? o.short.length + 2 : 0) + o.long.length;
    const longestOptionLength = options.reduce((max, o) => Math.max(max, getOptionLength(o)), 0);

    await sendMessage(body, makeTextMessage(
        "OEIS 查询插件：根据关键词检索 OEIS 序列并返回编号、描述和链接。"
        + `\n\n用法：${COMMAND_PREFIX} [..选项] [查询词]`
        + `\n选项：`
        + options.map(o => `\n\t${o.short ? `${o.short}, ` : ""}${o.long}${" ".repeat(longestOptionLength - getOptionLength(o))} ${o.description}`).join("")
        + "\n\n示例："
        + `\n\t${COMMAND_PREFIX} A118031`
        + `\n\t${COMMAND_PREFIX}.f A118031`
        + `\n\t${COMMAND_PREFIX}.f(1) 1, 1, 4`
        + `\n\t${COMMAND_PREFIX}.first(3) prime gap`
        + `\n\t${COMMAND_PREFIX}.help`
    ));
}

function toSequenceId(item: OeisItem): string | null {
    if (typeof item.id === "string" && /^A\d{6}$/i.test(item.id)) {
        return item.id.toUpperCase();
    }

    if (typeof item.number === "number" && Number.isFinite(item.number)) {
        return `A${Math.trunc(item.number).toString().padStart(6, "0")}`;
    }

    return null;
}

function normalizeResults(raw: unknown, limit: number): OeisItem[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .filter((item): item is OeisItem => typeof item === "object" && item !== null)
        .slice(0, limit);
}

const oeis = (async (body: MessageBody, data: TextMessageData) => {
    const invocation = parseInvocation(data.text);
    if (!invocation) {
        return;
    }

    if (invocation.help) {
        await sendHelpMessage(body);
        return;
    }

    try {
        const url = new URL("https://oeis.org/search");
        url.searchParams.set("fmt", "json");
        url.searchParams.set("q", invocation.query);

        const response = await fetch(url);
        if (!response.ok) {
            await sendReplyMessage(body, makeTextMessage(`OEIS 查询失败（HTTP ${response.status}）。`));
            return;
        }

        const payload = await response.json();
        const items = normalizeResults(payload, invocation.limit);

        if (items.length === 0) {
            await sendReplyMessage(body, makeTextMessage(`没有找到与「${invocation.query}」相关的 OEIS 序列：https://oeis.org/search?q=${encodeURIComponent(invocation.query)}`));
            return;
        }

        const lines = items
            .map((item) => {
                const sequenceId = toSequenceId(item);
                if (!sequenceId) {
                    return null;
                }

                const description = item.name?.trim() || "(no description)";
                return `https://oeis.org/${sequenceId}\n${sequenceId} ${description}`;
            })
            .filter((line): line is string => line !== null);

        if (lines.length === 0) {
            await sendReplyMessage(body, makeTextMessage(`没有找到可显示的 OEIS 结果。`));
            return;
        }

        await sendReplyMessage(body, makeTextMessage(lines.join("\n\n")));
    } catch (error) {
        logger.error({ error, query: invocation.query }, "OEIS query failed");
        await sendReplyMessage(body, makeTextMessage("OEIS 查询失败，请稍后再试。"));
    }
}) as Plugin;

oeis.acceptMessage = acceptsCommand;

export default oeis;
