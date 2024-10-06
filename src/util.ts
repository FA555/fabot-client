import axios from 'axios';

import { SERVER_URL } from './config';
import type { Message, MessageBody } from './model';

export const isChineseCharacter = (char: string): boolean => {
    return char >= '\u4e00' && char <= '\u9fa5';
}

// export const sendPrivateMessage = async (userId: number, message: Message, autoEscape: boolean = false): Promise<number> => {
//     let response = await axios.post(`${SERVER_URL}/send_private_msg`, {
//         user_id: userId,
//         message: message,
//         auto_escape: autoEscape,
//     });
//     return response.data.data.message_id;
// }

// export const sendGroupMessage = async (groupId: number, message: Message, autoEscape: boolean = false): Promise<number> => {
//     let response = await axios.post(`${SERVER_URL}/send_group_msg`, {
//         group_id: groupId,
//         message: message,
//         auto_escape: autoEscape,
//     });
//     return response.data.data.message_id;
// }

export const sendMessage = async (body: MessageBody, message: Message | Message[], autoEscape: boolean = false): Promise<number> => {
    console.log(message);

    let response = await axios.post(`${SERVER_URL}/send_msg`, {
        message_type: body.message_type,
        user_id: body.user_id,
        group_id: body.group_id,
        message: message,
        auto_escape: autoEscape,
    });

    console.log(response.data);
    return response.data.data.message_id;
}

export const sendReplyMessage = async (body: MessageBody, message: Message | Message[], autoEscape: boolean = false): Promise<number> => {
    let response = await axios.post(`${SERVER_URL}/send_msg`, {
        message_type: body.message_type,
        user_id: body.user_id,
        group_id: body.group_id,
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
    });

    return response.data.data.message_id;
}
