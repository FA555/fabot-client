import type { MessageBody, TextMessageData } from "../model";
import { sendMessage, sendReplyMessage } from "../util";

export const echo = async (body: MessageBody, data: TextMessageData) => {
    let text = data.text.slice(5).trimStart();

    if (text.startsWith("reply ")) {
        text = text.slice(6).trimStart();
        console.log(text.length);

        if (text.length === 0)
            return;

        sendReplyMessage(body, {
            type: "text",
            data: {
                text: text,
            }
        });
    } else {
        if (text.length === 0)
            return;

        sendMessage(body, {
            type: "text",
            data: {
                text: text,
            }
        });
    }
}
