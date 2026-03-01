import { Mutex } from 'async-mutex';
import { MAX_ATTEMPT_COUNT } from './config';
import { Answer, Attempt } from './model';

export enum State {
    Idle = 'Idle',
    Running = 'Running',
}

export class StateManager {
    private _state: State = State.Idle;
    private _answer: Answer | null = null;
    private _attempts: Attempt[] = [];
    mutex: Mutex = new Mutex();

    get state() {
        return this._state;
    }

    get answer() {
        return this._answer;
    }

    get attempts() {
        return this._attempts;
    }

    getAll() {
        return {
            state: this._state,
            answer: this._answer,
            attempts: this._attempts,
        }
    }

    start(answer: Answer) {
        this._state = State.Running;
        this._answer = answer;
    }

    async attempt(word: string): Promise<void> {
        // 不在游戏中，当作无事发生
        if (this._state !== State.Running)
            return;

        const attempt = new Attempt(word);
        await attempt.get_pinyin();

        this._attempts.push(attempt);
    }

    shouldFinish(): 'idle' | 'success' | 'fail' | 'continue' {
        if (this._state !== State.Running)
            return 'idle';

        if (this._attempts.length && this._attempts[this._attempts.length - 1].word === this._answer?.word)
            return 'success';

        if (this._attempts.length >= MAX_ATTEMPT_COUNT)
            return 'fail';

        return 'continue';
    }

    finish(): void {
        this._state = State.Idle;
        this._answer = null;
        this._attempts = [];
    }
}

class BotStateManager {
    private states = new Map<string, StateManager>();

    getState(identifier: string): StateManager {
        if (!this.states.has(identifier))
            this.states.set(identifier, new StateManager());

        return this.states.get(identifier) as StateManager;
    }

    start(identifier: string, answer: Answer) {
        this.getState(identifier).start(answer);
    }

    async attempt(identifier: string, word: string) {
        await this.getState(identifier).attempt(word);
    }

    shouldFinish(identifier: string): 'idle' | 'success' | 'fail' | 'continue' {
        return this.getState(identifier).shouldFinish();
    }

    finish(identifier: string) {
        this.getState(identifier).finish();
    }
}

export const botStateManager = new BotStateManager();
