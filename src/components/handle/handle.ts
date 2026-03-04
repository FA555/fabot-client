import axios from 'axios';

import { HANDLE_SERVER_URL } from '../../config';
import { getIdentifier, type Message, type MessageBody, type TextMessageData } from '../../model';
import type { Plugin } from '../../plugin';
import { isChineseCharacter, makeTextMessage, sendMessage, sendReplyMessage } from '../../util';
import { State, StateManager, botStateManager } from './state';
import type { AttemptOutcome } from './state';
import { Answer, getEffectiveExplanation } from './model';
import logger from '../../log';
import { MAX_ATTEMPT_COUNT, HANDLE_TIMEOUT_MS } from './config';

const timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
const HANDLE_COMMAND_PREFIX = "/handle";

interface HandleInvocation {
    strict: boolean;
    help: boolean;
    hint: boolean;
    roll: boolean
    payload: string;
}

const isInValidFormat = (word: string): boolean => {
    return word.length === 4 && word.split('').every(isChineseCharacter);
}

const clearTimeoutFor = (identifier: string) => {
    const timeout = timeoutHandles.get(identifier);
    if (!timeout)
        return;

    clearTimeout(timeout);
    timeoutHandles.delete(identifier);
};

const updateTimeout = (body: MessageBody) => {
    const identifier = getIdentifier(body);
    clearTimeoutFor(identifier);
    const timeout = setTimeout(() => {
        void finishByTimeout(identifier, body);
    }, HANDLE_TIMEOUT_MS);
    timeoutHandles.set(identifier, timeout);
};

const parseHandleInvocation = (text: string): HandleInvocation | null => {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith(HANDLE_COMMAND_PREFIX))
        return null;

    let remainder = trimmed.slice(HANDLE_COMMAND_PREFIX.length).trimStart();
    const invocation: HandleInvocation = {
        strict: false,
        help: false,
        hint: false,
        roll: false,
        payload: '',
    };

    while (remainder.startsWith('.')) {
        const match = remainder.match(/^(\.[a-zA-Z]+)\b/);
        if (!match)
            break;

        const flag = match[1].toLowerCase();
        if (flag === '.s' || flag === '.strict') {
            invocation.strict = true;
        } else if (flag === '.h' || flag === '.help') {
            invocation.help = true;
        } else if (flag === '.r' || flag === '.roll') {
            invocation.roll = true;
        } else if (flag === '.hint') {
            invocation.hint = true;
        } else {
            break;
        }

        remainder = remainder.slice(match[0].length).trimStart();
    }

    invocation.payload = remainder;
    return invocation;
};

const sendHelpMessage = async (body: MessageBody) => {
    await sendMessage(body, makeTextMessage(
        "Handle 是一个类似 Wordle 的猜成语游戏，最早由 https://github.com/antfu/handle 制作。\n\n"
        + "本 Handle Bot 的成语库来自 https://github.com/pwxcoo/chinese-xinhua，答案库为成语库和清华大学 https://github.com/thunlp/THUOCL 的交集的词频前 4000 名。\n\n"
        + "发送 /handle 即可开始游戏，选项 .strict 开启严格模式（只能猜测成语库中的成语），选项 .roll 随机带一个开局成语避免选择困难，选项 .hint 提供提示。\n\n"
        + "玩得开心！"
    ));
};

const getRandomAnswer = async (): Promise<Answer> => {
    const response = await axios.post(`${HANDLE_SERVER_URL}/start`);
    return new Answer(response.data.word, response.data.pinyin, response.data.explanation);
}

const getCurrentImageMessage = async (body: MessageBody, finished: boolean = false): Promise<Message | null | undefined> => {
    const current = botStateManager.getState(getIdentifier(body)).getAll();

    if (current.state === State.Idle)
        throw new Error("Unreachable from `drawCurrent`");

    if (finished && current.attempts.length === 0)
        return null;

    const response = await axios.post(`${HANDLE_SERVER_URL}/attempt`, {
        answer: current.answer,
        attempts: current.attempts,
        finished,
    });

    if (response.data?.message !== "ok" || !response.data.image_base64) {
        sendMessage(body, makeTextMessage("发生内部错误，请联系 fa_555 <fa_555@foxmail.com>。"));
        return undefined;
    }

    return {
        type: "image",
        data: { file: `base64://${response.data.image_base64}` },
    };
}

const drawCurrentImage = async (body: MessageBody) => {
    const imgMsg = await getCurrentImageMessage(body);
    if (!imgMsg)
        return;
    await sendReplyMessage(body, imgMsg);
}

const drawCurrentImageWithText = async (body: MessageBody, msg: Message) => {
    const msgArray = [msg];
    const imgMsg = await getCurrentImageMessage(body);
    if (!imgMsg)
        return;

    msgArray.push(imgMsg);
    await sendReplyMessage(body, msgArray);
}

const start = async (body: MessageBody, options?: { strict?: boolean, roll?: boolean }) => {
    const identifier = getIdentifier(body);

    if (botStateManager.getState(identifier).state !== State.Idle) {
        await drawCurrentImage(body);
        return;
    }

    const answer = await getRandomAnswer();
    const strict = !!options?.strict;

    botStateManager.start(identifier, answer, { strict });

    let initial = null;
    if (options?.roll) {
        while (initial === null || initial.toString() === answer.toString())
            initial = await getRandomAnswer();
        await botStateManager.attempt(identifier, initial.word);
    }

    logger.info(`[${identifier}] 开始 Handle${strict ? '（严格模式）' : ''}。答案：${answer}`);

    let msg = [makeTextMessage(
        `Handle 开始，${strict ? "严格模式只接受发送四字成语猜测词语" : '发送四字词语猜测成语'}。\n`
        + `最多猜测 ${MAX_ATTEMPT_COUNT} 次。`
    )];
    if (initial) {
        msg.push(makeTextMessage(`\n开局成语：${initial.word}`));
        const imgMsg = await getCurrentImageMessage(body);
        if (imgMsg)
            msg.push(imgMsg);
    }
    await sendMessage(body, msg);
}

const attempt = async (body: MessageBody, word: string): Promise<AttemptOutcome> => {
    const identifier = getIdentifier(body);
    return botStateManager.attempt(identifier, word);
}

const finish = async (body: MessageBody, state: StateManager, reason: string) => {
    const identifier = getIdentifier(body);
    clearTimeoutFor(identifier);

    const msg = [makeTextMessage(reason === 'success'
        ? `成功猜出正确答案！\n${state.answer?.toString()}`
        : `失败：${reason}。\n${state.answer?.toString()}`
    )];

    const imgMsg = await getCurrentImageMessage(body, true);
    if (imgMsg)
        msg.push(imgMsg);

    const sender = reason === '时间结束' ? sendMessage : sendReplyMessage;
    await sender(body, msg);
    state.finish();
}

const finishByTimeout = async (identifier: string, body: MessageBody) => {
    clearTimeoutFor(identifier);
    const release = await botStateManager.getState(identifier).mutex.acquire();

    try {
        const state = botStateManager.getState(identifier);
        if (state.state !== State.Running)
            return;

        await finish(body, state, '时间结束');
    } finally {
        release();
    }
}

const handlePlugin = (async (body: MessageBody, data: TextMessageData) => {
    const identifier = getIdentifier(body);
    const release = await botStateManager.getState(identifier).mutex.acquire();

    try {
        const stateAll = botStateManager.getState(identifier).getAll();
        const invocation = parseHandleInvocation(data.text);

        if (invocation?.help) {
            await sendHelpMessage(body);
            return;
        }

        if (invocation?.hint) {
            if (stateAll.state !== State.Running) {
                await sendMessage(body, makeTextMessage("没有正在进行的游戏。"));
                return;
            }
            const effectiveExplanation = getEffectiveExplanation(stateAll.answer!);
            await sendMessage(body, makeTextMessage(`提示：${effectiveExplanation}`));
            return;
        }

        const word = (invocation ? invocation.payload : data.text).trim();
        updateTimeout(body);

        if (stateAll.state === State.Idle) {
            if (invocation)
                await start(body, { strict: invocation.strict, roll: invocation.roll });
            if (!isInValidFormat(word))
                return;
        }

        if (word.length) {
            if (!isInValidFormat(word)) {
                await sendMessage(body, makeTextMessage(`你确定「${word}」是一个四字${stateAll.strict ? '成' : '词'}语吗？`));
                return;
            }

            const FORBIDDEN_CHARACTERS: { [key: string]: string } = { '嗯': 'ng', '噷': 'hm' };
            for (const char of word) {
                if (FORBIDDEN_CHARACTERS[char]) {
                    await sendMessage(body, makeTextMessage(`「${char}」的读音「${FORBIDDEN_CHARACTERS[char]}」太特殊了，换一个词吧！`));
                    return;
                }
            }

            const attemptResult = await attempt(body, word);

            if (attemptResult === 'invalid') {
                await sendMessage(body, makeTextMessage(`严格模式只能猜测成语。你确定「${word}」是个成语吗？`));
                return;
            }
        }

        const state = botStateManager.getState(identifier);
        switch (state.shouldFinish()) {
            case 'success':
                await finish(body, state, 'success');
                break;
            case 'fail':
                await finish(body, state, '尝试次数用尽');
                break;
            case 'continue':
                await drawCurrentImage(body);
        }
    } finally {
        release();
    }
}) as Plugin;

handlePlugin.acceptMessage = (text: string): boolean => {
    return text.trimStart().startsWith(HANDLE_COMMAND_PREFIX) || isInValidFormat(text.trim());
}

export default handlePlugin;
