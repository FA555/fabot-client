import { SERVER_URL } from './config';
import type { Message, MessageBody } from './model';
import { botAxios } from './network';
import { getAuditContext, getAuditStore } from './audit';

export interface NapCatSendResponse {
    status?: string;
    retcode?: number;
    data?: {
        message_id?: string | number;
    };
}

interface SendTarget {
    messageType: 'group' | 'private';
    id: string | number | undefined;
    replyToMessageId?: string;
}

class NapCatSendError extends Error {
    constructor(message: string, readonly retcode?: number) {
        super(message);
        this.name = "NapCatSendError";
    }
}

export function getNapCatMessageId(response: NapCatSendResponse): string | number {
    if (response.status === "failed" || (typeof response.retcode === "number" && response.retcode !== 0)) {
        throw new NapCatSendError(`NapCat send failed with retcode ${response.retcode ?? "unknown"}`, response.retcode);
    }
    const messageId = response.data?.message_id;
    if (typeof messageId !== "string" && typeof messageId !== "number") {
        throw new NapCatSendError("NapCat send response is missing message_id", response.retcode);
    }
    return messageId;
}

export const isChineseCharacter = (char: string): boolean => {
    return char >= '\u4e00' && char <= '\u9fa5';
}

export const getAvatarUrl = (user_id: number, size: 40 | 100 | 140 | 640 = 640): string => {
    return `https://q1.qlogo.cn/g?b=qq&nk=${user_id}&s=${size}`;
}

export const makeTextMessage = (text: string): Message => {
    return { type: "text", data: { text } };
}

function summarizeMessage(message: Message | Message[]): { textLength: number; imageCount: number; segmentCount: number } {
    const segments = Array.isArray(message) ? message : [message];
    return {
        textLength: segments.reduce((length, segment) => (
            segment.type === "text" && "text" in segment.data
                ? length + segment.data.text.length
                : length
        ), 0),
        imageCount: segments.filter(segment => segment.type === "image").length,
        segmentCount: segments.length,
    };
}

function getErrorCode(error: unknown): string {
    if (error instanceof Error) {
        return error.name.slice(0, 100);
    }
    return "UnknownError";
}

async function sendAuditedMessage(
    target: SendTarget,
    message: Message | Message[],
    autoEscape = false,
): Promise<number> {
    const context = getAuditContext();
    const summary = summarizeMessage(message);
    if (target.replyToMessageId) {
        summary.segmentCount += 1;
    }
    const startedAt = Date.now();
    const payload = {
        message_type: target.messageType,
        user_id: target.messageType === 'private' ? target.id?.toString() : undefined,
        group_id: target.messageType === 'group' ? target.id?.toString() : undefined,
        message: target.replyToMessageId
            ? [{ type: "reply", data: { id: target.replyToMessageId } }, ...(Array.isArray(message) ? message : [message])]
            : message,
        auto_escape: autoEscape,
    };

    try {
        const response = await botAxios.post<NapCatSendResponse>(`${SERVER_URL}/send_msg`, payload);
        const retcode = response.data?.retcode;
        const messageId = getNapCatMessageId(response.data);

        getAuditStore().recordOutbound({
            auditId: context?.auditId,
            pluginName: context?.pluginName,
            source: context?.source ?? "direct",
            messageKind: target.replyToMessageId ? "reply" : "message",
            chatType: target.messageType,
            chatId: typeof target.id === "number" ? target.id : Number(target.id) || undefined,
            replyToMessageId: target.replyToMessageId,
            ...summary,
            status: "succeeded",
            napcatMessageId: String(messageId),
            httpStatus: response.status,
            retcode,
            durationMs: Date.now() - startedAt,
            excludeFromStats: context?.excludeFromStats,
        });
        return Number(messageId);
    } catch (error) {
        const response = typeof error === "object" && error && "response" in error
            ? (error.response as { status?: number; data?: NapCatSendResponse } | undefined)
            : undefined;
        getAuditStore().recordOutbound({
            auditId: context?.auditId,
            pluginName: context?.pluginName,
            source: context?.source ?? "direct",
            messageKind: target.replyToMessageId ? "reply" : "message",
            chatType: target.messageType,
            chatId: typeof target.id === "number" ? target.id : Number(target.id) || undefined,
            replyToMessageId: target.replyToMessageId,
            ...summary,
            status: "failed",
            httpStatus: response?.status,
            retcode: error instanceof NapCatSendError ? error.retcode : response?.data?.retcode,
            durationMs: Date.now() - startedAt,
            errorCode: getErrorCode(error),
            excludeFromStats: context?.excludeFromStats,
        });
        throw error;
    }
}

function getBodyTarget(body: MessageBody): SendTarget {
    return {
        messageType: body.message_type,
        id: body.message_type === "group" ? body.group_id : body.user_id ?? body.sender?.user_id,
    };
}

export const sendMessageRaw = async (
    messageType: 'group' | 'private',
    id: string | number | undefined,
    message: Message | Message[],
): Promise<number> => sendAuditedMessage({ messageType, id }, message);

export const sendMessage = async (
    body: MessageBody,
    message: Message | Message[],
    autoEscape = false,
): Promise<number> => sendAuditedMessage(getBodyTarget(body), message, autoEscape);

export const sendReplyMessage = async (
    body: MessageBody,
    message: Message | Message[],
    autoEscape = false,
): Promise<number> => sendAuditedMessage({
    ...getBodyTarget(body),
    replyToMessageId: body.message_id.toString(),
}, message, autoEscape);
