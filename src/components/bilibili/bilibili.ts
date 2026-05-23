import type { MessageBody, TextMessageData } from "../../model";
import { botFetch } from "../../network";
import type { Plugin } from "../../plugin";
import logger from "../../log";
import { makeTextMessage, sendReplyMessage } from "../../util";

interface BilibiliInvocation {
    query: string;
}

interface BilibiliSearchItem {
    bvid?: string;
}

interface BilibiliSearchResponse {
    code?: number;
    message?: string;
    data?: {
        result?: BilibiliSearchItem[];
    };
}

const COMMAND_PREFIX = "/bili";
const BILIBILI_COOKIE = process.env.BILIBILI_COOKIE?.trim();

function buildHeaders(referer: string): HeadersInit {
    const headers: HeadersInit = {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "referer": referer,
        "origin": "https://www.bilibili.com",
    };

    if (BILIBILI_COOKIE) {
        headers.cookie = BILIBILI_COOKIE;
    }

    return headers;
}

function acceptsCommand(text: string): boolean {
    return text.trimStart().startsWith(COMMAND_PREFIX);
}

function parseInvocation(text: string): BilibiliInvocation | null {
    if (!acceptsCommand(text)) {
        return null;
    }

    const query = text.trimStart().slice(COMMAND_PREFIX.length).trim();
    if (!query) {
        return null;
    }

    return { query };
}

function getTopBvid(payload: unknown): string | null {
    const result = (payload as BilibiliSearchResponse | null | undefined)?.data?.result;
    if (!Array.isArray(result) || result.length === 0) {
        return null;
    }

    const bvid = result[0]?.bvid;
    if (typeof bvid !== "string" || bvid.trim().length === 0) {
        return null;
    }

    return bvid.trim();
}

function extractBvidFromHtml(html: string): string | null {
    const matched = html.match(/BV[1-9A-HJ-NP-Za-km-z]{10}/);
    return matched ? matched[0] : null;
}

async function queryBvidFromApi(query: string): Promise<{ bvid: string | null; fallbackReason?: string }> {
    const encodedKeyword = encodeURIComponent(query);
    const requestUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodedKeyword}`;

    const response = await botFetch(requestUrl, {
        headers: buildHeaders("https://www.bilibili.com"),
    });

    if (!response.ok) {
        return { bvid: null, fallbackReason: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return { bvid: null, fallbackReason: "non-json response" };
    }

    const payload = await response.json();
    const bvid = getTopBvid(payload);
    if (!bvid) {
        return { bvid: null, fallbackReason: "empty search result" };
    }

    return { bvid };
}

async function queryBvidFromWebPage(query: string): Promise<string | null> {
    const encodedKeyword = encodeURIComponent(query);
    const pageUrl = `https://search.bilibili.com/all?keyword=${encodedKeyword}`;

    const response = await botFetch(pageUrl, {
        headers: buildHeaders("https://search.bilibili.com/"),
    });

    if (!response.ok) {
        return null;
    }

    const html = await response.text();
    return extractBvidFromHtml(html);
}

const bilibili = (async (body: MessageBody, data: TextMessageData) => {
    const invocation = parseInvocation(data.text);
    if (!invocation) {
        return;
    }

    try {
        const apiResult = await queryBvidFromApi(invocation.query);
        let bvid = apiResult.bvid;

        if (!bvid) {
            bvid = await queryBvidFromWebPage(invocation.query);
            if (bvid) {
                logger.warn({ query: invocation.query, reason: apiResult.fallbackReason }, "Bilibili API failed; used web page fallback");
            }
        }

        if (!bvid) {
            await sendReplyMessage(body, makeTextMessage(`没有找到「${invocation.query}」相关视频。`));
            return;
        }

        await sendReplyMessage(body, makeTextMessage(bvid));
    } catch (error) {
        logger.error({ error, query: invocation.query }, "Bilibili search failed");
        await sendReplyMessage(body, makeTextMessage("Bilibili 查询失败，请稍后再试。"));
    }
}) as Plugin;

bilibili.acceptMessage = acceptsCommand;

export default bilibili;
