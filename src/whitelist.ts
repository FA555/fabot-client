import fs from "fs";

interface WhitelistItem {
    description: string,
    type: string,
    number: number,
}

const whitelist = JSON.parse(fs.readFileSync("config/whitelist.json", "utf8")) as WhitelistItem[];

export const isInWhiteList = (type: string, number: number | undefined): string | null => {
    
    for (let item of whitelist)
        if (item.type === type && item.number === number)
            return item.description;

    return null;
}
