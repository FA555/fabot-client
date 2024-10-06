import axios from 'axios';

import { HANDLE_SERVER_URL } from '../../config';
import { getIdentifier, type MessageBody, type MessageData, type TextMessageData } from '../../model';
import { isChineseCharacter, sendMessage, sendReplyMessage } from '../../util';
import { State, StateManager, botStateManager } from './state';
import { Answer } from './model';
import logger from '../../log';
import { MAX_ATTEMPT_COUNT } from './config';

const getRandomAnswer = async (): Promise<Answer> => {
    const response = await axios.post(`${HANDLE_SERVER_URL}/start`);
    return new Answer(response.data.word, response.data.pinyin, response.data.explanation);
}

const getCurrentImage = async (body: MessageBody): Promise<string | undefined> => {
    const current = botStateManager.getState(getIdentifier(body)).getAll();

    if (current.state === State.Idle)
        throw new Error("Unreachable from `drawCurrent`");

    const response = await axios.post(`${HANDLE_SERVER_URL}/attempt`, {
        answer: current.answer,
        attempts: current.attempts,
    });

    if (response.data?.message !== "ok" || !response.data.image_base64) {
        sendMessage(body, {
            type: "text",
            data: {
                text: "发生内部错误，请联系 fa_555 <fa_555@foxmail.com>。",
            }
        });
        return;
    }

    return response.data.image_base64;
}

const drawCurrentImage = async (body: MessageBody) => {
    const image_base64 = await getCurrentImage(body);
    sendReplyMessage(body, {
        type: "image",
        data: {
            file: `base64://${image_base64}`,
        }
    });
}

const start = async (body: MessageBody) => {
    if (botStateManager.getState(getIdentifier(body)).state !== State.Idle) {
        drawCurrentImage(body);
        return;
    }

    const answer = await getRandomAnswer();
    botStateManager.start(getIdentifier(body), answer);
    logger.info(`[${getIdentifier(body)} 开始 Handle。答案：${answer}`);

    await sendMessage(body, {
        type: "text",
        data: {
            text: `游戏开始，请发送四字词语进行猜测。最多猜测 ${MAX_ATTEMPT_COUNT} 次。`,
        }
    });
}

const attempt = async (body: MessageBody, word: string) => {
    await botStateManager.attempt(getIdentifier(body), word);
}

const instantFinish = async (body: MessageBody, state: StateManager, reason: string) => {
    await sendReplyMessage(body, [{
        type: "text",
        data: {
            text: reason === 'success'
                ? `成功猜出正确答案！\n${state.answer?.toString()}`
                : `失败：${reason}。\n${state.answer?.toString()}`,
        },
    }, {
        type: "image",
        data: {
            file: `base64://${await getCurrentImage(body)}`,
        }
    }]);

    state.finish();
}

const app = async (body: MessageBody, data: TextMessageData) => {
    const stateAll = botStateManager.getState(getIdentifier(body)).getAll();

    if (data.text.startsWith("/handle") && stateAll.state === State.Idle) {
        start(body);
        return;
    }

    if (stateAll.state === State.Idle)
        return;

    const word = (data.text.startsWith("/handle") ? data.text.slice(8) : data.text).trim();

    if (word.length && word.length !== 4) {
        sendMessage(body, {
            type: "text",
            data: {
                text: `你确定「${word}」是一个四字词语吗？`,
            }
        });
        return;
    }

    if (word.length === 4)
        await attempt(body, word);

    const stateCurrentAll = botStateManager.getState(getIdentifier(body));
    switch (stateCurrentAll.shouldFinish()) {
        case 'success':
            await instantFinish(body, stateCurrentAll, 'success');
            break;
        case 'fail':
            await instantFinish(body, stateCurrentAll, '尝试次数用尽');
            break;
        case 'continue':
            await drawCurrentImage(body);
    }
}

app.acceptMessage = (text: string): boolean => {
    return text === "/handle" || text.startsWith("/handle ")
        || (text.length === 4 && text.split('').every(isChineseCharacter));
}

export default app;
