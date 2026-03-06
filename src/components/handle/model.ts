import axios from "axios";
import pinyin from "pinyin";

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

export const getEffectiveExplanation = (answer: Answer): string => {
    let sentences = answer.explanation.split("。");
    if (sentences.at(-1) === "")
        sentences.pop();

    let index = -1;
    let explanation = [sentences.at(index--) || ""];
    while (explanation.at(-1)?.match(/^[②-⑳]/))
        explanation.push(sentences.at(index--) || "");
    return explanation.reverse().join("。") + "。";
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
