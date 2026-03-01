import axios from 'axios';

import { HANDLE_SERVER_URL } from '../../config';
import { getIdentifier, type MessageBody, type TextMessageData } from '../../model';
import type { Plugin } from '../../plugin';
import { isChineseCharacter, makeTextMessage, sendMessage, sendReplyMessage } from '../../util';
import { State, StateManager, botStateManager } from './state';
import { Answer } from './model';
import logger from '../../log';
import { MAX_ATTEMPT_COUNT, HANDLE_TIMEOUT_MS } from './config';

const timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();

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
        finishByTimeout(identifier, body);
    }, HANDLE_TIMEOUT_MS);
    timeoutHandles.set(identifier, timeout);
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

const start = async (identifier: string, body: MessageBody) => {
    if (botStateManager.getState(identifier).state !== State.Idle) {
        await drawCurrentImage(body);
        scheduleTimeout(identifier, body);
        return;
    }

    const answer = await getRandomAnswer();
    botStateManager.start(identifier, answer);
    scheduleTimeout(identifier, body);
    logger.info(`[${identifier} 开始 Handle。答案：${answer}`);

    await sendMessage(body, makeTextMessage(`Handle 开始，发送四字词语猜测成语。\n最多猜测 ${MAX_ATTEMPT_COUNT} 次。`));
}

const attempt = async (identifier: string, word: string) => {
    await botStateManager.attempt(identifier, word);
}

const instantFinish = async (identifier: string, body: MessageBody, state: StateManager, reason: string) => {
    clearTimeoutFor(identifier);

    let msg = [makeTextMessage(reason === 'success'
        ? `成功猜出正确答案！\n${state.answer?.toString()}`
        : `失败：${reason}。\n${state.answer?.toString()}`
    )];

    let image_base64 = await getCurrentImage(body, true);
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

        if (data.text.startsWith("/handle") && stateAll.state === State.Idle) {
            await start(identifier, body);
            return;
        }

        if (stateAll.state === State.Idle)
            return;

        const word = (data.text.startsWith("/handle") ? data.text.slice(8) : data.text).trim();

        if (!word.split('').every(isChineseCharacter) || (word.length && word.length !== 4)) {
            await sendMessage(body, makeTextMessage(`你确定「${word}」是一个四字词语吗？`));
            scheduleTimeout(identifier, body);
            return;
        }

        if (word.length === 4) {
            await attempt(identifier, word);
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
    return text === "/handle" || text.startsWith("/handle ")
        || (text.length === 4 && text.split('').every(isChineseCharacter));
}

export default handlePlugin;
