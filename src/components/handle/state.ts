import { Mutex } from 'async-mutex';
import { MAX_ATTEMPT_COUNT } from './config';
import { type Answer, Attempt } from './model';

export enum State {
    Idle = 'Idle',
    Running = 'Running',
}

export type AttemptOutcome = 'idle' | 'invalid' | 'recorded';

export class StateManager {
    private _state: State = State.Idle;
    private _answer: Answer | null = null;
    private _attempts: Attempt[] = [];
    private _strict: boolean = false;
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

    get strict() {
        return this._strict;
    }

    getAll() {
        return {
            state: this._state,
            answer: this._answer,
            attempts: this._attempts,
            strict: this._strict,
        }
    }

    start(answer: Answer, options?: { strict?: boolean }) {
        this._state = State.Running;
        this._answer = answer;
        this._strict = !!options?.strict;
        this._attempts = [];
    }

    async attempt(word: string): Promise<AttemptOutcome> {
        // 不在游戏中，当作无事发生
        if (this._state !== State.Running)
            return 'idle';

        const attempt = new Attempt(word);
        await attempt.get_pinyin();

        if (this._strict && !attempt.verified)
            return 'invalid';

        this._attempts.push(attempt);
        return 'recorded';
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
        this._strict = false;
    }
}

class BotStateManager {
    private states = new Map<string, StateManager>();

    getState(identifier: string): StateManager {
        if (!this.states.has(identifier))
            this.states.set(identifier, new StateManager());

        return this.states.get(identifier) as StateManager;
    }

    start(identifier: string, answer: Answer, options?: { strict?: boolean }) {
        this.getState(identifier).start(answer, options);
    }

    async attempt(identifier: string, word: string): Promise<AttemptOutcome> {
        return this.getState(identifier).attempt(word);
    }

    shouldFinish(identifier: string): 'idle' | 'success' | 'fail' | 'continue' {
        return this.getState(identifier).shouldFinish();
    }

    finish(identifier: string) {
        this.getState(identifier).finish();
    }
}

export const botStateManager = new BotStateManager();
