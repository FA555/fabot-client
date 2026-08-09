import type { MessageBody, TextMessageData } from "../../model";
import type { Plugin } from "../../plugin";
import { makeTextMessage, sendReplyMessage } from "../../util";
import { matchesCommand } from "../../command";

const COMMAND_PREFIX = "/help";

function acceptsCommand(text: string): boolean {
    return matchesCommand(text, COMMAND_PREFIX);
}

function buildHelpMessage(): string {
    return [
        "FaBot 帮助",
        "",
        "常用命令：",
        "/ai [内容]：和 AI 对话（人设由高人编写）",
        "/ai.s [内容]：联网搜索后让 AI 回答",
        "/bili [关键词]：搜索 Bilibili 视频，返回 BV 号",
        "/oeis [数列|关键词]：OEIS 搜索",
        "/leetcode：获取 LeetCode 每日一题",
        "/typst [内容]：渲染 Typst 文本为图片",
        "/handle：开始一局 Handle 游戏",
        "",
        "其他：",
        "- 自动解析北邮人论坛帖子内容。",
        "- 大部分命令有其他参数；部分命令支持 .h / .help，例如 /handle.h, /oeis.help。",
    ].join("\n");
}

const help = (async (body: MessageBody, data: TextMessageData) => {
    if (!acceptsCommand(data.text)) {
        return;
    }

    await sendReplyMessage(body, makeTextMessage(buildHelpMessage()));
}) as Plugin;

help.acceptMessage = acceptsCommand;

export default help;
