import type { MessageBody, TextMessageData } from "../../model";
import { make_text_message as makeTextMessage, sendMessage, sendReplyMessage } from "../../util";
import { isSuperAdmin } from "../../whitelist";
import type { Plugin } from "../../plugin";

interface EchoCommand {
    reply: boolean;
    payload: string;
}

const COMMAND_PREFIX = "/echo";

const acceptsCommand = (text: string): boolean => {
    return text.trimStart().startsWith(COMMAND_PREFIX);
}

const parseCommand = (text: string): EchoCommand | null => {
    if (!text)
        return null;

    if (!acceptsCommand(text))
        return null;

    let normalized = text.trimStart().slice(COMMAND_PREFIX.length).trimStart();
    let reply = false;

    while (true) {
        const flag = normalized.match(/^.r\b/);

        if (flag) {
            reply = true;
            normalized = normalized.slice(flag[0].length).trimStart();
            continue;
        }

        break;
    }

    if (normalized.length === 0)
        return null;

    return {
        reply,
        payload: normalized,
    };
}

const echo = (async (body: MessageBody, data: TextMessageData) => {
    if (!isSuperAdmin(body.user_id)) {
        await sendMessage(body, makeTextMessage("不听你的 嘻嘻"));
        return;
    }

    const command = parseCommand(data.text);
    if (!command)
        return;

    const sender = command.reply ? sendReplyMessage : sendMessage;
    await sender(body, makeTextMessage(command.payload));
}) as Plugin;

echo.acceptMessage = acceptsCommand;

export default echo;
