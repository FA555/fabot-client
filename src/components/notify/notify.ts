import type { MessageBody, TextMessageData } from "../../model";
import type { Plugin } from "../../plugin";
import logger from "../../log";
import { getAvatarUrl, makeTextMessage, sendReplyMessage } from "../../util";
import { isInWhiteList } from "../../whitelist";

interface EmergencyInvocation {
    payload: string;
}

const COMMAND_PREFIX = "/emergency";
const EMERGENCY_WEBHOOK_BASE = "https://api.day.app/WG4jBZmpVtnHpWauHpBaJS";

function acceptsCommand(text: string): boolean {
    return text.trimStart().startsWith(COMMAND_PREFIX);
}

function parseInvocation(text: string): EmergencyInvocation | null {
    if (!acceptsCommand(text)) {
        return null;
    }

    const payload = text.trimStart().slice(COMMAND_PREFIX.length).trim();
    return { payload };
}

function buildEmergencyWebhookUrl(sender_id: number, sender: string, content: string): string {
    const encodedSender = encodeURIComponent(sender);
    const encodedContent = encodeURIComponent(content);
    const url = new URL(`${EMERGENCY_WEBHOOK_BASE}/${encodedSender}/${encodedContent}/`);
    url.searchParams.set("group", 'Bot转发消息');
    url.searchParams.set("icon", getAvatarUrl(sender_id));
    return url.toString();
}

const notify = (async (body: MessageBody, data: TextMessageData) => {
    const invocation = parseInvocation(data.text);
    if (!invocation)
        return;

    if (!invocation.payload) {
        await sendReplyMessage(body, [
            makeTextMessage("用法：/emergency [要推送的消息]\n\n用于有急事的时候找不在的 "),
            { type: "at", data: { qq: "591752976" } },
            makeTextMessage("。\n要是 spam 就杀了你。"),
        ]);
        return;
    }

    try {
        const senderName = body.sender.nickname;
        const groupName = body.message_type === "group" ? isInWhiteList(body) : "私聊";
        const sender = `${senderName}@${groupName}`;

        const url = buildEmergencyWebhookUrl(body.sender.user_id, sender, invocation.payload);
        const response = await fetch(url, { method: "GET" });

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
