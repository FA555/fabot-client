import type { MessageBody, TextMessageData } from "../../model";
import { botFetch } from "../../network";
import type { Plugin } from "../../plugin";
import logger from "../../log";
import { getAvatarUrl, makeTextMessage, sendReplyMessage } from "../../util";
import { isInWhiteList } from "../../whitelist";
import { matchesCommand } from "../../command";
import { loadEmergencyConfig, type EmergencyConfig } from "./config";

interface EmergencyInvocation {
    payload: string;
}

const COMMAND_PREFIX = "/emergency";

function acceptsCommand(text: string): boolean {
    return matchesCommand(text, COMMAND_PREFIX, { allowOptions: true });
}

function parseInvocation(text: string): EmergencyInvocation | null {
    if (!acceptsCommand(text)) {
        return null;
    }

    const payload = text.trimStart().slice(COMMAND_PREFIX.length).trim();
    return { payload };
}

function buildEmergencyWebhookUrl(webhookBase: string, sender_id: number, sender: string, content: string): string {
    const encodedSender = encodeURIComponent(sender);
    const encodedContent = encodeURIComponent(content);
    const url = new URL(`${webhookBase}/${encodedSender}/${encodedContent}/`);
    url.searchParams.set("group", 'Bot转发消息');
    url.searchParams.set("icon", getAvatarUrl(sender_id));
    return url.toString();
}

const notify = (async (body: MessageBody, data: TextMessageData) => {
    const invocation = parseInvocation(data.text);
    if (!invocation)
        return;

    let config: EmergencyConfig | null;
    try {
        config = loadEmergencyConfig();
    } catch (error) {
        logger.error({ error }, "Invalid emergency notification configuration");
        return;
    }
    if (!config || !config.allowedUserIds.has(body.sender.user_id)) {
        return;
    }

    if (!invocation.payload) {
        await sendReplyMessage(body, [
            makeTextMessage("用法：/emergency [要推送的消息]"),
            ...(config.targetUserId
                ? [makeTextMessage("\n\n用于有急事的时候联系 "), { type: "at", data: { qq: config.targetUserId } }]
                : []),
        ]);
        return;
    }

    try {
        const senderName = body.sender.nickname;
        const groupName = body.message_type === "group" ? isInWhiteList(body) : "私聊";
        const sender = `${senderName}@${groupName}`;

        const url = buildEmergencyWebhookUrl(config.webhookBase, body.sender.user_id, sender, invocation.payload);
        const response = await botFetch(url, { method: "GET" });

        if (!response.ok) {
            logger.warn({ status: response.status, group_id: body.group_id, user_id: body.user_id }, "Emergency webhook responded with non-OK status");
            await sendReplyMessage(body, makeTextMessage(`消息推送失败。`));
            return;
        }

        await sendReplyMessage(body, makeTextMessage("消息已推送。"));
    } catch (error) {
        logger.error({ error, group_id: body.group_id, user_id: body.user_id }, "Emergency webhook request failed");
        await sendReplyMessage(body, makeTextMessage("推送失败，请稍后重试。"));
    }
}) as Plugin;

notify.acceptMessage = acceptsCommand;

export default notify;
