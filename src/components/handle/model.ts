import axios from "axios";
import pinyin from "pinyin";

import { HANDLE_SERVER_URL } from "../../config";


const get_pinyin = async (word: string): Promise<string> => {
    const response = await axios.get(`${HANDLE_SERVER_URL}/try_get_pinyin?word=${word}`);

    if (response.data?.pinyin)
        return response.data.pinyin;

    return pinyin(word, { style: 2 }).flat().join(" ");
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
        return `答案：${this.word}\n释义：${this.explanation}`;
    }
}

export class Attempt {
    word: string
    pinyin: string | null = null

    constructor(word: string) {
        this.word = word;
    }

    async get_pinyin(): Promise<void> {
        this.pinyin = await get_pinyin(this.word);
    }
}
