import fs from "fs";
import { parse } from "yaml";
import type { MessageBody } from "./model";

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

const whitelist: Whitelist = parse(fs.readFileSync("config/whitelist.yaml", "utf8"));

export const isInWhiteList = (body: MessageBody): string | null => {
    const { message_type, group_id, user_id } = body;
    const id = message_type === "group" ? group_id : user_id;
    const type = message_type === "group" ? "group" : "private";

    if (!type)
        return null;

    for (let item of whitelist[type])
        if (item.id === id)
            return item.name;

    return null;
}

export const isInWhiteListById = (type: "private" | "group", id: number): string | null => {
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

export const getSuperAdmins = (): Array<{ name: string; id: number }> => {
    return whitelist.private
        .filter(item => item.super)
        .map(item => ({ name: item.name, id: item.id }));
}
