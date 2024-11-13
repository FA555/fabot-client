import axios from "axios";
import pinyin, { STYLE_TONE2 } from "pinyin";

import { HANDLE_SERVER_URL } from "../../config";


const get_pinyin = async (word: string): Promise<[string, boolean]> => {
    const response = await axios.get(`${HANDLE_SERVER_URL}/try_get_pinyin?word=${word}`);

    if (response.data?.pinyin)
        return [response.data.pinyin, true];

    return [pinyin(word, {
        style: 2,
        segment: true,
    }).flat().join(" ").replaceAll('v', 'ü'), false];
}

export class Answer {
    word: string
    pinyin: string
    explanation: string

    constructor(word: string, pinyin: string, explanation: string) {
        this.word = word;
        this.pinyin = pinyin;
        this.explanation = explanation;
    }

    toString(): string {
        return `【答案】${this.word}\n【释义】${this.explanation}`;
    }
}

export class Attempt {
    word: string
    pinyin: string | null = null
    verified: boolean | null = null

    constructor(word: string) {
        this.word = word;
    }

    async get_pinyin(): Promise<void> {
        [this.pinyin, this.verified] = await get_pinyin(this.word);
    }
}
