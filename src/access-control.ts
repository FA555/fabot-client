import { readFileSync } from "node:fs";

import { parse } from "yaml";

import type { MessageBody } from "./model";

export type PluginCapability = "invoke" | "observe";

export interface PluginAccessContext {
    whitelisted: boolean;
}

type ChatType = MessageBody["message_type"];
type UnknownRecord = Record<string, unknown>;

interface PrivateAccessEntry {
    name: string;
    id: number;
    super?: boolean;
}

interface GroupAccessEntry {
    name: string;
    id: number;
}

interface AccessControlConfig {
    private: PrivateAccessEntry[];
    group: GroupAccessEntry[];
    plugin_policy?: unknown;
}

const accessControlPath = process.env.WHITELIST_PATH?.trim() || "config/whitelist.yaml";
const accessControlConfig = parse(readFileSync(accessControlPath, "utf8")) as AccessControlConfig;

export const isInWhiteList = (body: MessageBody): string | null => {
    const type = body.message_type === "group" ? "group" : "private";
    const id = type === "group" ? body.group_id : body.user_id;
    return accessControlConfig[type].find(item => item.id === id)?.name ?? null;
};

export const isInWhiteListById = (type: "private" | "group", id: number): string | null => {
    return accessControlConfig[type].find(item => item.id === id)?.name ?? null;
};

export const isSuperAdmin = (id: number | undefined): boolean => {
    return typeof id === "number"
        && accessControlConfig.private.some(item => item.super && item.id === id);
};

export const getSuperAdmins = (): Array<{ name: string; id: number }> => {
    return accessControlConfig.private
        .filter(item => item.super)
        .map(item => ({ name: item.name, id: item.id }));
};

interface CapabilitySettings {
    enabled?: boolean;
    invoke?: boolean;
    observe?: boolean;
}

interface PluginSettings extends CapabilitySettings {
    modes?: Partial<Record<ChatType, CapabilitySettings>>;
}

interface RuleMatch {
    chatType?: ChatType;
    chatIds?: ReadonlySet<number>;
    actorUserIds?: ReadonlySet<number>;
    superAdmin?: boolean;
    whitelisted?: boolean;
}

interface CompiledRule {
    match: RuleMatch;
    plugins: ReadonlyMap<string, CapabilitySettings>;
}

export interface PluginPolicy {
    isEnabled(
        pluginName: string,
        capability: PluginCapability,
        body: MessageBody,
        access: PluginAccessContext,
    ): boolean;
}

const ROOT_KEYS: Record<string, true> = { version: true, defaults: true, plugins: true, rules: true };
const CAPABILITY_KEYS: Record<string, true> = { enabled: true, invoke: true, observe: true };
const PLUGIN_KEYS: Record<string, true> = { ...CAPABILITY_KEYS, modes: true };
const MODE_KEYS: Record<string, true> = { private: true, group: true };
const RULE_KEYS: Record<string, true> = { id: true, description: true, match: true, plugins: true };
const MATCH_KEYS: Record<string, true> = {
    chat_type: true,
    chat_ids: true,
    actor_user_ids: true,
    super_admin: true,
    whitelisted: true,
};

function asRecord(value: unknown, path: string): UnknownRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as UnknownRecord;
}

function assertKnownKeys(record: UnknownRecord, allowedKeys: Readonly<Record<string, true>>, path: string): void {
    for (const key of Object.keys(record)) {
        if (!allowedKeys[key]) {
            throw new Error(`${path} contains unknown key: ${key}`);
        }
    }
}

function readOptionalBoolean(record: UnknownRecord, key: string, path: string): boolean | undefined {
    const value = record[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "boolean") {
        throw new Error(`${path}.${key} must be a boolean`);
    }
    return value;
}

function parseCapabilitySettings(value: unknown, path: string): CapabilitySettings {
    const record = asRecord(value, path);
    assertKnownKeys(record, CAPABILITY_KEYS, path);
    return {
        enabled: readOptionalBoolean(record, "enabled", path),
        invoke: readOptionalBoolean(record, "invoke", path),
        observe: readOptionalBoolean(record, "observe", path),
    };
}

function parsePluginSettings(value: unknown, path: string): PluginSettings {
    const record = asRecord(value, path);
    assertKnownKeys(record, PLUGIN_KEYS, path);
    const settings: PluginSettings = {
        enabled: readOptionalBoolean(record, "enabled", path),
        invoke: readOptionalBoolean(record, "invoke", path),
        observe: readOptionalBoolean(record, "observe", path),
    };

    if (record.modes !== undefined) {
        const modes = asRecord(record.modes, `${path}.modes`);
        assertKnownKeys(modes, MODE_KEYS, `${path}.modes`);
        settings.modes = {};
        for (const chatType of ["private", "group"] as const) {
            if (modes[chatType] !== undefined) {
                settings.modes[chatType] = parseCapabilitySettings(
                    modes[chatType],
                    `${path}.modes.${chatType}`,
                );
            }
        }
    }

    return settings;
}

function assertKnownPlugin(pluginName: string, knownPlugins: ReadonlySet<string>, path: string): void {
    if (pluginName !== "*" && !knownPlugins.has(pluginName)) {
        throw new Error(`Unknown plugin at ${path}: ${pluginName}`);
    }
}

function parsePluginSettingsMap(
    value: unknown,
    knownPlugins: ReadonlySet<string>,
    path: string,
    allowModes: boolean,
): Map<string, PluginSettings | CapabilitySettings> {
    const record = asRecord(value, path);
    const result = new Map<string, PluginSettings | CapabilitySettings>();
    for (const [pluginName, settings] of Object.entries(record)) {
        assertKnownPlugin(pluginName, knownPlugins, path);
        result.set(
            pluginName,
            allowModes
                ? parsePluginSettings(settings, `${path}.${pluginName}`)
                : parseCapabilitySettings(settings, `${path}.${pluginName}`),
        );
    }
    return result;
}

function parsePositiveIntegerSet(value: unknown, path: string): ReadonlySet<number> {
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array of positive integers`);
    }
    const result = new Set<number>();
    for (const item of value) {
        if (!Number.isSafeInteger(item) || (item as number) <= 0) {
            throw new Error(`${path} must contain only positive integers`);
        }
        result.add(item as number);
    }
    return result;
}

function parseRuleMatch(value: unknown, path: string): RuleMatch {
    const record = asRecord(value, path);
    assertKnownKeys(record, MATCH_KEYS, path);
    const result: RuleMatch = {};

    if (record.chat_type !== undefined) {
        if (record.chat_type !== "private" && record.chat_type !== "group") {
            throw new Error(`${path}.chat_type must be private or group`);
        }
        result.chatType = record.chat_type;
    }
    if (record.chat_ids !== undefined) {
        result.chatIds = parsePositiveIntegerSet(record.chat_ids, `${path}.chat_ids`);
    }
    if (record.actor_user_ids !== undefined) {
        result.actorUserIds = parsePositiveIntegerSet(record.actor_user_ids, `${path}.actor_user_ids`);
    }
    if (record.super_admin !== undefined) {
        if (typeof record.super_admin !== "boolean") {
            throw new Error(`${path}.super_admin must be a boolean`);
        }
        result.superAdmin = record.super_admin;
    }
    if (record.whitelisted !== undefined) {
        if (typeof record.whitelisted !== "boolean") {
            throw new Error(`${path}.whitelisted must be a boolean`);
        }
        result.whitelisted = record.whitelisted;
    }

    return result;
}

function parseRules(
    value: unknown,
    knownPlugins: ReadonlySet<string>,
): CompiledRule[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error("plugin policy rules must be an array");
    }

    const ids = new Set<string>();
    return value.map((rawRule, index) => {
        const path = `plugin policy rules[${index}]`;
        const rule = asRecord(rawRule, path);
        assertKnownKeys(rule, RULE_KEYS, path);
        if (typeof rule.id !== "string" || !rule.id.trim()) {
            throw new Error(`${path}.id must be a non-empty string`);
        }
        if (ids.has(rule.id)) {
            throw new Error(`Duplicate rule ID: ${rule.id}`);
        }
        ids.add(rule.id);
        if (rule.description !== undefined && typeof rule.description !== "string") {
            throw new Error(`${path}.description must be a string`);
        }
        if (rule.match === undefined) {
            throw new Error(`${path}.match is required`);
        }
        if (rule.plugins === undefined) {
            throw new Error(`${path}.plugins is required`);
        }

        return {
            match: parseRuleMatch(rule.match, `${path}.match`),
            plugins: parsePluginSettingsMap(
                rule.plugins,
                knownPlugins,
                `${path}.plugins`,
                false,
            ) as ReadonlyMap<string, CapabilitySettings>,
        };
    });
}

function applySettings(
    current: boolean,
    settings: CapabilitySettings | undefined,
    capability: PluginCapability,
): boolean {
    if (!settings) {
        return current;
    }
    const enabled = settings.enabled ?? current;
    return settings[capability] ?? enabled;
}

function matchesRule(match: RuleMatch, body: MessageBody, access: PluginAccessContext): boolean {
    if (!access.whitelisted && match.whitelisted !== false) {
        return false;
    }
    if (match.whitelisted !== undefined && match.whitelisted !== access.whitelisted) {
        return false;
    }
    if (match.chatType !== undefined && match.chatType !== body.message_type) {
        return false;
    }

    const actorUserId = body.user_id ?? body.sender?.user_id;
    const chatId = body.message_type === "group" ? body.group_id : actorUserId;
    if (match.chatIds && (chatId === undefined || !match.chatIds.has(chatId))) {
        return false;
    }
    if (match.actorUserIds && (actorUserId === undefined || !match.actorUserIds.has(actorUserId))) {
        return false;
    }
    if (match.superAdmin !== undefined && isSuperAdmin(actorUserId) !== match.superAdmin) {
        return false;
    }
    return true;
}

export function compilePluginPolicy(rawConfig: unknown, registeredPluginNames: readonly string[]): PluginPolicy {
    const root = asRecord(rawConfig, "plugin policy");
    assertKnownKeys(root, ROOT_KEYS, "plugin policy");
    if (root.version !== 1) {
        throw new Error("plugin policy version must be 1");
    }

    const knownPlugins = new Set(registeredPluginNames);
    const defaults = root.defaults === undefined
        ? { enabled: true }
        : parseCapabilitySettings(root.defaults, "plugin policy.defaults");
    const pluginSettings = root.plugins === undefined
        ? new Map<string, PluginSettings>()
        : parsePluginSettingsMap(
            root.plugins,
            knownPlugins,
            "plugin policy.plugins",
            true,
        ) as Map<string, PluginSettings>;
    const rules = parseRules(root.rules, knownPlugins);

    return {
        isEnabled(pluginName, capability, body, access): boolean {
            let enabled = false;
            if (access.whitelisted) {
                enabled = applySettings(true, defaults, capability);
                const wildcard = pluginSettings.get("*");
                enabled = applySettings(enabled, wildcard, capability);
                enabled = applySettings(enabled, wildcard?.modes?.[body.message_type], capability);
                const plugin = pluginSettings.get(pluginName);
                enabled = applySettings(enabled, plugin, capability);
                enabled = applySettings(enabled, plugin?.modes?.[body.message_type], capability);
            }
            for (const rule of rules) {
                if (matchesRule(rule.match, body, access)) {
                    enabled = applySettings(enabled, rule.plugins.get("*"), capability);
                    enabled = applySettings(enabled, rule.plugins.get(pluginName), capability);
                }
            }
            return enabled;
        },
    };
}

export const defaultPluginPolicy: PluginPolicy = {
    isEnabled: (_pluginName, _capability, _body, access) => access.whitelisted,
};

export function loadPluginPolicy(registeredPluginNames: readonly string[]): PluginPolicy {
    if (accessControlConfig.plugin_policy === undefined) {
        return defaultPluginPolicy;
    }
    return compilePluginPolicy(accessControlConfig.plugin_policy, registeredPluginNames);
}
