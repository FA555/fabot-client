import { SERVER_URL } from "./config";
import { getLoginNickname } from "./login-info";
import logger from "./log";
import type { AtMessageData, FaceMessageData, MessageBody, MfaceMessageData, TextMessageData } from "./model";
import { botAxios } from "./network";

interface GetUserInfoResponse {
    data?: {
        nickname?: string;
        card?: string;
    };
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

async function flattenAt(data: AtMessageData, body: MessageBody): Promise<string> {
    const qq = data.qq.toString();
    if (qq === "all") {
        return '<at target="all">全体成员</at>';
    }

    let knownName = data.name?.trim()
        || (qq === body.sender?.user_id?.toString() ? body.sender.nickname?.trim() || body.sender.card?.trim() : "")
        || (qq === body.self_id?.toString() ? getLoginNickname() : "");
    if (!knownName && /^\d+$/.test(qq)) {
        try {
            const endpoint = body.message_type === "group" ? "get_group_member_info" : "get_stranger_info";
            const request = body.message_type === "group"
                ? { group_id: body.group_id, user_id: qq, no_cache: true }
                : { user_id: qq, no_cache: true };
            const response = await botAxios.post<GetUserInfoResponse>(`${SERVER_URL}/${endpoint}`, request);
            knownName = response.data.data?.nickname?.trim() || response.data.data?.card?.trim() || "";
        } catch (error) {
            logger.warn({ error, qq, groupId: body.group_id }, "Failed to fetch mentioned user while flattening");
        }
    }

    const name = knownName ? ` name="${escapeXml(knownName)}"` : "";
    return `<at qq="${escapeXml(qq)}"${name}>${escapeXml(knownName || qq)}</at>`;
}

export async function flattenMessage(body: MessageBody): Promise<TextMessageData | null> {
    if (!body.message?.length) {
        return null;
    }

    const parts: string[] = [];
    for (const message of body.message) {
        switch (message.type) {
            case "text":
                parts.push((message.data as TextMessageData).text);
                break;
            case "image":
                parts.push("[图片]");
                break;
            case "face":
                parts.push((message.data as FaceMessageData).raw?.faceText || "[表情]");
                break;
            case "mface":
                parts.push((message.data as MfaceMessageData).summary || "[动画表情]");
                break;
            case "at":
                parts.push(await flattenAt(message.data as AtMessageData, body));
                break;
            case "reply":
                break;
            default:
                parts.push(`<message type="${escapeXml(message.type)}">尚不支持此消息类型</message>`);
                break;
        }
    }

    const flattened = parts.join("").trim();
    return flattened ? { text: flattened } : null;
}
