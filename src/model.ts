export interface TextMessageData {
    text: string,
}

export interface ReplyMessageData {
    // TODO
}

export interface ForwardMessageData {
    // TODO
}

export interface AtMessageData {
    // TODO
}

export interface VideoMessageData {
    // TODO
}

export interface ImageMessageData {
    // TODO
}

export interface RecordMessageData {
    // TODO
}

export interface MfaceMessageData {
    // TODO
}

export type MessageData = TextMessageData | VideoMessageData | ReplyMessageData | ImageMessageData | RecordMessageData | MfaceMessageData;

export interface Message {
    type: string,
    data: MessageData,
}

export interface Sender {
    user_id: number,
    nickname: string,
    card: string,
    role?: string,
}

export interface MessageBody {
    meta_event_type?: string,
    message_type?: 'private' | 'group',
    sub_type: string,
    message_id: number | string,
    group_id?: number,
    user_id?: number,
    message?: Message[],
    raw_message: string,
    font: number,
    sender: Sender,
    time: number,
    self_id: number,
    post_type: string,
}

export const getIdentifier = (body: MessageBody): string => {
    if (body.message_type === "group") {
        return `group_${body.group_id}`;
    } else if (body.message_type === "private") {
        return `private_${body.user_id}`;
    } else {
        throw new Error("Unknown message type");
    }
}
