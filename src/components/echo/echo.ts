import type { MessageBody, TextMessageData } from "../../model";
import { makeTextMessage, sendMessage, sendReplyMessage } from "../../util";
import { isInWhiteListById } from "../../access-control";
import type { Plugin } from "../../plugin";
import { matchesCommand } from "../../command";

interface EchoCommand {
    reply: boolean;
    payload: string;
}

const COMMAND_PREFIX = "/echo";

const acceptsCommand = (text: string): boolean => {
    return matchesCommand(text, COMMAND_PREFIX, { allowOptions: true });
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

function getMsg(payload: string): string {
    let trivial = false;
    for (const ch of "不听你的")
        if (!payload.includes(ch)) {
            trivial = true;
            break;
        }

    const countOf嘻 = payload.split("嘻").length - 1;
    if (trivial || countOf嘻 < 2)
        return "不听你的 嘻嘻";

    return `不听你的 ${"嘻".repeat(countOf嘻 + 1)}`;
}

const echo = (async (body: MessageBody, data: TextMessageData) => {
    const command = parseCommand(data.text);
    if (!command)
        return;

    if (!isInWhiteListById('private', body.sender.user_id)) {
        const msg = getMsg(command.payload);
        await sendMessage(body, makeTextMessage(msg));
        return;
    }

    const sender = command.reply ? sendReplyMessage : sendMessage;
    await sender(body, makeTextMessage(command.payload));
}) as Plugin;

echo.acceptMessage = acceptsCommand;

export default echo;
