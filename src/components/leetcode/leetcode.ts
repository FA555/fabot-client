import { convert } from "html-to-text";
import { execa } from "execa";
import { chmod, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";

import logger from "../../log";
import type { Message, MessageBody, TextMessageData } from "../../model";
import { botFetch } from "../../network";
import type { Plugin } from "../../plugin";
import { makeTextMessage, sendMessage, sendReplyMessage } from "../../util";

interface LeetcodeQuestion {
    questionFrontendId?: string;
    title?: string;
    titleSlug?: string;
    translatedTitle?: string;
    translatedContent?: string;
    difficulty?: string;
    topicTags?: LeetcodeTopicTag[];
    stats?: string;
}

interface LeetcodeTopicTag {
    name?: string;
    translatedName?: string;
    slug?: string;
}

interface LeetcodeTodayRecord {
    date?: string;
    question?: LeetcodeQuestion;
}

interface LeetcodeDailyResponse {
    data?: {
        todayRecord?: LeetcodeTodayRecord[];
    };
    errors?: unknown[];
}

interface LeetcodeStats {
    acRate?: string;
    totalAccepted?: string;
    totalSubmission?: string;
}

const COMMAND_PREFIX = "/leetcode";
const LEETCODE_GRAPHQL_URL = "https://leetcode.cn/graphql/";
const TEMPLATE_FILE = fileURLToPath(new URL("./template.typ", import.meta.url));
const LEETCODE_DAILY_QUERY = `
query questionOfToday {
  todayRecord {
    date
    question {
      questionFrontendId
      title
      titleSlug
      translatedTitle
      translatedContent
      difficulty
      topicTags {
        name
        translatedName
        slug
      }
      stats
    }
  }
}`;

function acceptsCommand(text: string): boolean {
    return text.trimStart().startsWith(COMMAND_PREFIX);
}

function parseInvocation(text: string): boolean {
    if (!acceptsCommand(text)) {
        return false;
    }

    const remainder = text.trimStart().slice(COMMAND_PREFIX.length).trim();
    return remainder.length === 0;
}

function difficultyToChinese(difficulty?: string): string {
    if (difficulty === "Easy") {
        return "简单";
    }
    if (difficulty === "Medium") {
        return "中等";
    }
    if (difficulty === "Hard") {
        return "困难";
    }
    return difficulty || "未知";
}

function parseStats(stats?: string): LeetcodeStats | null {
    if (!stats) {
        return null;
    }

    try {
        return JSON.parse(stats) as LeetcodeStats;
    } catch (error) {
        logger.warn({ error, stats }, "Failed to parse LeetCode stats");
        return null;
    }
}

function getRawTextContent(node: unknown): string {
    if (!node || typeof node !== "object") {
        return "";
    }

    const data = "data" in node ? node.data : undefined;
    if (typeof data === "string") {
        return data;
    }

    const children = "children" in node ? node.children : undefined;
    if (!Array.isArray(children)) {
        return "";
    }

    return children.map(getRawTextContent).join("");
}

function getPreMarkdownContent(node: unknown): string {
    if (!node || typeof node !== "object") {
        return "";
    }

    const data = "data" in node ? node.data : undefined;
    if (typeof data === "string") {
        return data;
    }

    const children = "children" in node ? node.children : undefined;
    if (!Array.isArray(children)) {
        return "";
    }

    const name = "name" in node && typeof node.name === "string" ? node.name.toLowerCase() : "";
    const content = children.map(getPreMarkdownContent).join("");
    if (name === "b" || name === "strong") {
        if (content.trim().length === 0) {
            return "";
        }

        return ` **${content}** `;
    }

    return content;
}

function preTextToMarkdownQuote(text: string): string {
    return text
        .replace(/\u00a0/g, " ")
        .replace(/\n$/, "")
        .split("\n")
        .flatMap(line => [`> ${line}`.trimEnd(), ">"])
        .slice(0, -1)
        .join("\n");
}

function htmlToMarkdown(html: string): string {
    return convert(html, {
        wordwrap: false,
        formatters: {
            markdownBold: (elem, walk, builder) => {
                if (getRawTextContent(elem).trim().length === 0) {
                    return;
                }

                builder.addInline(" **");
                walk(elem.children || [], builder);
                builder.addInline("** ");
            },
            markdownEmphasis: (elem, walk, builder) => {
                if (getRawTextContent(elem).trim().length === 0) {
                    return;
                }

                builder.addInline(" *");
                walk(elem.children || [], builder);
                builder.addInline("* ");
            },
            markdownBlockquote: (elem, _walk, builder, formatOptions) => {
                builder.openBlock({ leadingLineBreaks: formatOptions.leadingLineBreaks ?? 2, isPre: true });
                builder.addLiteral(preTextToMarkdownQuote(getPreMarkdownContent(elem)));
                builder.closeBlock({
                    trailingLineBreaks: formatOptions.trailingLineBreaks ?? 2,
                    blockTransform: text => text.trimEnd(),
                });
            },
        },
        selectors: [
            { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
            { selector: "b", format: "markdownBold" },
            { selector: "strong", format: "markdownBold" },
            { selector: "em", format: "markdownEmphasis" },
            { selector: "code", format: "inlineSurround", options: { prefix: "`", suffix: "`" } },
            { selector: "pre", format: "markdownBlockquote", options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
        ],
    })
        .replace(/\u00a0/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function fetchDailyQuestion(): Promise<LeetcodeTodayRecord | null> {
    const response = await botFetch(LEETCODE_GRAPHQL_URL, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "referer": "https://leetcode.cn/problemset/",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({ query: LEETCODE_DAILY_QUERY }),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json() as LeetcodeDailyResponse;
    if (payload.errors && payload.errors.length > 0) {
        throw new Error("GraphQL response contains errors");
    }

    return payload.data?.todayRecord?.[0] || null;
}

function formatDailyQuestionMarkdown(record: LeetcodeTodayRecord): string | null {
    const question = record.question;
    if (!question?.translatedContent || !question.titleSlug) {
        return null;
    }

    const questionId = question.questionFrontendId ? `${question.questionFrontendId}. ` : "";
    const title = question.translatedTitle || question.title || question.titleSlug;
    const link = `https://leetcode.cn/problems/${question.titleSlug}/`;
    const tags = question.topicTags
        ?.map(tag => tag.translatedName || tag.name)
        .filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
        .join("、") || "无";
    const stats = parseStats(question.stats);
    const content = htmlToMarkdown(question.translatedContent);

    return [
        `# LeetCode 每日一题 ${record.date || ""}`.trim(),
        `## ${questionId}${title}`,
        [
            "| 难度 | 标签 | 通过率 |",
            "| :---: | :---: | :---: |",
            `| ${difficultyToChinese(question.difficulty)} | ${tags} | ${stats?.acRate || "未知"} |`,
        ].join("\n"),
        content,
    ].filter((line): line is string => Boolean(line)).join("\n\n");
}

class LeetcodeRenderWorkspace {
    private path = "";
    private state: "uninitialized" | "initialized" | "rendered" = "uninitialized";

    mainFile(): string {
        return join(this.path, "main.typ");
    }

    markdownFile(): string {
        return join(this.path, "question.md");
    }

    async init(markdown: string): Promise<void> {
        this.path = await mkdtemp(fileURLToPath(new URL("./", import.meta.url)));
        await chmod(this.path, 0o755);
        await copyFile(TEMPLATE_FILE, this.mainFile());
        await writeFile(this.markdownFile(), markdown, "utf-8");
        this.state = "initialized";
    }

    async render(binaryName: string = "typst", ppi: number = 180): Promise<void> {
        if (this.state !== "initialized") {
            throw new Error("LeetcodeRenderWorkspace must be initialized before rendering.");
        }

        const { stderr, failed, exitCode } = await execa(binaryName, [
            "compile",
            "--root", `${this.path}/`,
            "--ppi", ppi.toString(),
            "--input", "input=question.md",
            this.mainFile(),
            join(this.path, "{0p}.png"),
        ], { reject: false });

        if (failed) {
            throw new Error(`Typst compile failed with exit code ${exitCode}: ${stderr.trim()}`);
        }

        this.state = "rendered";
    }

    async getPages(): Promise<string[]> {
        if (this.state !== "rendered") {
            throw new Error("LeetcodeRenderWorkspace must be rendered before reading pages.");
        }

        return (await readdir(this.path))
            .filter(fileName => fileName.endsWith(".png"))
            .sort((l, r) => Number.parseInt(l, 10) - Number.parseInt(r, 10))
            .map(fileName => join(this.path, fileName));
    }

    async cleanup(): Promise<void> {
        await rm(this.path, { recursive: true, force: true });
    }
}

async function renderMarkdownToImages(markdown: string): Promise<Message[]> {
    const ws = new LeetcodeRenderWorkspace();
    try {
        await ws.init(markdown);
        await ws.render();
        const pageFiles = await ws.getPages();
        const messages = await Promise.all(pageFiles.map(async file => ({
            type: "image",
            data: { file: `base64://${await readFile(file, "base64")}` },
        }) as Message));

        return messages;
    } finally {
        await ws.cleanup();
    }
}

const leetcode = (async (body: MessageBody, data: TextMessageData) => {
    const invocation = parseInvocation(data.text);
    if (!invocation) {
        await sendReplyMessage(body, makeTextMessage(`用法：${COMMAND_PREFIX}\n获取 LeetCode 中文站每日一题 Markdown 文本。`));
        return;
    }

    try {
        const record = await fetchDailyQuestion();
        if (!record) {
            await sendReplyMessage(body, makeTextMessage("没有获取到 LeetCode 每日一题。"));
            return;
        }

        const markdown = formatDailyQuestionMarkdown(record);
        if (!markdown) {
            await sendReplyMessage(body, makeTextMessage("LeetCode 每日一题数据不完整，无法生成 Markdown。"));
            return;
        }

        const rendered = await renderMarkdownToImages(markdown);
        if (rendered.length === 0) {
            await sendReplyMessage(body, makeTextMessage("LeetCode 每日一题渲染失败，没有生成图片。"));
            return;
        }

        await sendMessage(body, rendered);
    } catch (error) {
        logger.error({ error }, "LeetCode daily question query failed");
        await sendReplyMessage(body, makeTextMessage("LeetCode 每日一题获取失败，请稍后再试。"));
    }
}) as Plugin;

leetcode.acceptMessage = acceptsCommand;

export default leetcode;
