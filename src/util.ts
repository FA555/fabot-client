import axios from 'axios';

import { SERVER_URL } from './config';
import type { Message, MessageBody } from './model';

export const isChineseCharacter = (char: string): boolean => {
    return char >= '\u4e00' && char <= '\u9fa5';
}

export const getAvatarUrl = (user_id: number, size: 40 | 100 | 140 | 640 = 640): string => {
    return `https://q1.qlogo.cn/g?b=qq&nk=${user_id}&s=${size}`;
}

export const makeTextMessage = (text: string): Message => {
    return { type: "text", data: { text } };
}

export const sendMessageRaw = async (messageType: 'group' | 'private', id: string | number | undefined, message: Message | Message[]): Promise<number> => {
    let msg = {
        message_type: messageType,
        user_id: messageType === 'private' ? id?.toString() : undefined,
        group_id: messageType === 'group' ? id?.toString() : undefined,
        message: message,
    };

    let response = await axios.post(`${SERVER_URL}/send_msg`, msg);
    // console.log(response.data);
    return response.data.data.message_id;
}

export const sendMessage = async (body: MessageBody, message: Message | Message[], autoEscape: boolean = false): Promise<number> => {
    let msg = {
        message_type: body.message_type,
        user_id: body.user_id?.toString(),
        group_id: body.group_id?.toString(),
        message: message,
        auto_escape: autoEscape,
    };

    // console.log("sendMessage: " + JSON.stringify(msg));
    let response = await axios.post(`${SERVER_URL}/send_msg`, msg);
    // console.log(response.data);
    return response.data.data.message_id;
}

export const sendReplyMessage = async (body: MessageBody, message: Message | Message[], autoEscape: boolean = false): Promise<number> => {
    let msg = {
        message_type: body.message_type,
        user_id: body.user_id?.toString(),
        group_id: body.group_id?.toString(),
        message: [
            {
                type: "reply",
                data: {
                    id: body.message_id.toString(),
                },
            },
            ...(Array.isArray(message) ? message : [message]),
        ],
        auto_escape: autoEscape,
    };

    // console.log("sendReplyMessage: " + JSON.stringify(msg));
    let response = await axios.post(`${SERVER_URL}/send_msg`, msg);
    console.log(response.data);
    return response.data.data.message_id;
}
