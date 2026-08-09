import logger from "../../log";
import type { MessageBody, TextMessageData } from "../../model";
import { botFetch } from "../../network";
import type { Plugin } from "../../plugin";
import { makeTextMessage, sendMessage } from "../../util";
import type { ThreadResponse } from "./model";

import { convert } from "html-to-text";

function extractMatchedUrls(text: string): string[] | null {
    const regex = /bbs6?\.byr\.cn\/(?:#!)?article\/[a-zA-Z0-9_]+\/\d+(\?p=\d+)?\/?/g;
    const matches = text.match(regex);
    return matches ? Array.from(new Set(matches)) : null;
}

const parseByrbbsLink = (url: string): string | null => {
    const regex = /bbs6?\.byr\.cn\/(?:#!)?article\/([a-zA-Z0-9_]+)\/(\d+)\/?/;
    const match = url.match(regex);
    if (match) {
        const board = match[1]; // 第一个捕获组：版块名称
        const id = match[2];    // 第二个捕获组：帖子ID
        return `https://bbs.byr.cn/n/b/article/${board}/${id}.json`;
    }
    return null;
}

const htmlToRawText = (htmlStr: string): string => {
    return convert(htmlStr, {
        formatters: { customImage: (_elem, _walk, builder, _formatOptions) => builder.addInline('[图片]') },
        selectors: [
            { selector: 'img', format: 'customImage' },
            { selector: 'a[href^="/att/"]', format: 'skip' }, // 针对图片
            { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
        ]
    })
        .replace(/(\[图片\])\s+(?=\[图片\])/g, '$1')
        .replaceAll(/\n{3,}/g, '\n\n')
        .trim();
}

export const byrbbs = (async (body: MessageBody, data: TextMessageData) => {
    const urls = extractMatchedUrls(data.text);
    if (!urls || urls.length === 0)
        return;

    for (const url of urls) {
        const apiUrl = parseByrbbsLink(url);
        if (!apiUrl)
            continue;

        try {
            const response = await botFetch(apiUrl);
            if (!response.ok) {
                logger.error(`Failed to fetch data from ${apiUrl}: ${response.status} ${response.statusText}`);
                continue;
            }

            const jsonData: ThreadResponse = await response.json();
            const thread = jsonData.data;

            const threadHead = thread.head;
            const title = thread.title;
            const posterName = 'user_name' in threadHead.poster ? threadHead.poster.user_name : threadHead.poster.id;
            const time = threadHead.time;

            const content = thread.articles.find(article => article.subject)?.content;
            if (!content)
                throw new Error("主帖内容缺失");
            const rawText = htmlToRawText(content);

            await sendMessage(body, makeTextMessage(`【${title}】– ${posterName} @ ${time}（北邮人论坛）\n\n${rawText}`));
        } catch (error) {
            logger.error(`Error fetching data from ${apiUrl}: ${error}`);
            await sendMessage(body, makeTextMessage(`无法获取帖子内容，可能是链接无效或帖子已被删除。`));
        }
    }
}) as Plugin;

byrbbs.acceptMessage = (text: string): boolean => {
    const urls = extractMatchedUrls(text);
    return urls !== null && urls.length > 0;
}

export default byrbbs;
