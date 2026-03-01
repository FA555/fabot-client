import axios from 'axios';

import { HANDLE_SERVER_URL } from '../../config';
import { getIdentifier, type MessageBody, type TextMessageData } from '../../model';
import type { Plugin } from '../../plugin';
import { isChineseCharacter, makeTextMessage, sendMessage, sendReplyMessage } from '../../util';
import { State, StateManager, botStateManager } from './state';
import type { AttemptOutcome } from './state';
import { Answer } from './model';
import logger from '../../log';
import { MAX_ATTEMPT_COUNT, HANDLE_TIMEOUT_MS } from './config';

const timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
const HANDLE_COMMAND_PREFIX = "/handle";

interface HandleInvocation {
    strict: boolean;
    help: boolean;
    roll: boolean;
    payload: string;
}

const clearTimeoutFor = (identifier: string) => {
    const timeout = timeoutHandles.get(identifier);
    if (!timeout)
        return;

    clearTimeout(timeout);
    timeoutHandles.delete(identifier);
};

const scheduleTimeout = (identifier: string, body: MessageBody) => {
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
        roll: false,
        payload: remainder,
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
        } else {
            break;
        }

        remainder = remainder.slice(match[0].length).trimStart();
    }

    return invocation;
};

const sendHelpMessage = async (body: MessageBody) => {
    await sendMessage(body, makeTextMessage(
        "Handle 是一个类似 Wordle 的猜成语游戏，最早由 https://github.com/antfu/handle 制作。\n\n"
        + "本 Handle Bot 的成语库来自 https://github.com/pwxcoo/chinese-xinhua，答案库为成语库和清华大学 https://github.com/thunlp/THUOCL 的交集的词频前 4000 名。\n\n"
        + "发送 /handle 即可开始游戏，选项 .strict 开启严格模式（只能猜测成语库中的成语），选项 .roll 随机带一个开局成语避免选择困难。\n\n"
        + "玩得开心！"
    ));
};

const getRandomAnswer = async (): Promise<Answer> => {
    const response = await axios.post(`${HANDLE_SERVER_URL}/start`);
    return new Answer(response.data.word, response.data.pinyin, response.data.explanation);
}

const getCurrentImage = async (body: MessageBody, finished: boolean = false): Promise<string | null | undefined> => {
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

    return response.data.image_base64;
}

const drawCurrentImage = async (body: MessageBody) => {
    const image_base64 = await getCurrentImage(body);
    if (!image_base64)
        return;
    await sendReplyMessage(body, {
        type: "image",
        data: { file: `base64://${image_base64}` },
    });
}

const start = async (identifier: string, body: MessageBody, options?: { strict?: boolean, roll?: boolean }) => {
    if (botStateManager.getState(identifier).state !== State.Idle) {
        await drawCurrentImage(body);
        scheduleTimeout(identifier, body);
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

    scheduleTimeout(identifier, body);
    logger.info(`[${identifier}] 开始 Handle${strict ? '（严格模式）' : ''}。答案：${answer}`);

    let msg = [makeTextMessage(
        `Handle 开始，${strict ? "严格模式只接受发送四字成语猜测词语" : '发送四字词语猜测成语'}。\n`
        + `最多猜测 ${MAX_ATTEMPT_COUNT} 次。`
    )];
    if (initial) {
        msg.push(makeTextMessage(`\n开局成语：${initial.word}`));
        const image_base64 = await getCurrentImage(body);
        if (image_base64)
            msg.push({ type: "image", data: { file: `base64://${image_base64}` } });
    }
    await sendMessage(body, msg);
}

const attempt = async (identifier: string, word: string): Promise<AttemptOutcome> => {
    return botStateManager.attempt(identifier, word);
}

const instantFinish = async (identifier: string, body: MessageBody, state: StateManager, reason: string) => {
    clearTimeoutFor(identifier);

    const msg = [makeTextMessage(reason === 'success'
        ? `成功猜出正确答案！\n${state.answer?.toString()}`
        : `失败：${reason}。\n${state.answer?.toString()}`
    )];

    const image_base64 = await getCurrentImage(body, true);
    if (image_base64) {
        msg.push({
            type: "image",
            data: { file: `base64://${image_base64}` },
        });
    }

    await sendReplyMessage(body, msg);
    state.finish();
}

const finishByTimeout = async (identifier: string, body: MessageBody) => {
    clearTimeoutFor(identifier);
    const release = await botStateManager.getState(identifier).mutex.acquire();

    try {
        const state = botStateManager.getState(identifier);
        if (state.state !== State.Running)
            return;

        await instantFinish(identifier, body, state, '时间结束');
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
            if (stateAll.state === State.Running)
                scheduleTimeout(identifier, body);
            return;
        }

        if (stateAll.state === State.Idle) {
            if (invocation)
                await start(identifier, body, { strict: invocation.strict, roll: invocation.roll });
            return;
        }

        const word = (invocation ? invocation.payload : data.text).trim();
        if ((word.length && word.length !== 4) || !word.split('').every(isChineseCharacter)) {
            await sendMessage(body, makeTextMessage(`你确定「${word}」是一个四字${stateAll.strict ? '成' : '词'}语吗？`));
            scheduleTimeout(identifier, body);
            return;
        }

        if (word.length === 4) {
            const attemptResult = await attempt(identifier, word);

            if (attemptResult === 'invalid') {
                await sendMessage(body, makeTextMessage(`严格模式只能猜测成语。你确定「${word}」是个成语吗？`));
                scheduleTimeout(identifier, body);
                return;
            }

            if (attemptResult === 'recorded')
                scheduleTimeout(identifier, body);
        }

        const stateCurrentAll = botStateManager.getState(identifier);
        switch (stateCurrentAll.shouldFinish()) {
            case 'success':
                await instantFinish(identifier, body, stateCurrentAll, 'success');
                break;
            case 'fail':
                await instantFinish(identifier, body, stateCurrentAll, '尝试次数用尽');
                break;
            case 'continue':
                await drawCurrentImage(body);
        }
    } finally {
        release();
    }
}) as Plugin;

handlePlugin.acceptMessage = (text: string): boolean => {
    return text.trimStart().startsWith(HANDLE_COMMAND_PREFIX)
        || (text.length === 4 && text.split('').every(isChineseCharacter));
}

export default handlePlugin;
