import type { MessageBody, TextMessageData } from "./model";

export type Plugin = ((body: MessageBody, data: TextMessageData) => Promise<void> | void) & {
    acceptMessage: (text: string, body: MessageBody) => boolean;
    observeMessage?: (body: MessageBody, data: TextMessageData) => Promise<void> | void;
};
