import fs from "fs";

interface WhitelistPrivateItem {
    name: string,
    id: number,
    super?: boolean,
}
interface WhitelistGroupItem {
    name: string,
    id: number,
}

interface Whitelist {
    private: WhitelistPrivateItem[],
    group: WhitelistGroupItem[],
}

const whitelist: Whitelist = JSON.parse(fs.readFileSync("config/whitelist.json", "utf8"));

export const isInWhiteList = (type: 'private' | 'group' | undefined, id: number | undefined): string | null => {
    if (!type)
        return null;

    for (let item of whitelist[type])
        if (item.id === id)
            return item.name;

    return null;
}

export const isSuperAdmin = (id: number | undefined): boolean => {
    if (typeof id !== "number")
        return false;

    return whitelist.private.some(item => item.super && item.id === id);
}
