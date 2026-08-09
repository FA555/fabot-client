import { randomUUID } from "node:crypto";

import { getAuditStore, runWithAuditContext, type AuditStore } from "./audit";
import { getLoginUserId } from "./login-info";
import logger from "./log";
import { flattenMessage } from "./message-flattener";
import type { MessageBody, TextMessageData } from "./model";
import type { RegisteredPlugin } from "./plugin";
import { allowAllPluginPolicy, isInWhiteList, type PluginPolicy } from "./access-control";

interface MessageHandlerDependencies {
    store?: AuditStore;
    flatten?: (body: MessageBody) => Promise<TextMessageData | null>;
    isWhitelisted?: (body: MessageBody) => string | null;
    getSelfId?: () => number | null;
    pluginPolicy?: PluginPolicy;
}

function getChatId(body: MessageBody): number | undefined {
    return body.message_type === "group" ? body.group_id : body.user_id;
}

export async function handleMessage(
    body: MessageBody,
    plugins: RegisteredPlugin[],
    dependencies: MessageHandlerDependencies = {},
): Promise<void> {
    if (body.meta_event_type === "heartbeat") {
        logger.info("Heartbeat");
        return;
    }

    const store = dependencies.store ?? getAuditStore();
    const flatten = dependencies.flatten ?? flattenMessage;
    const isWhitelisted = dependencies.isWhitelisted ?? isInWhiteList;
    const pluginPolicy = dependencies.pluginPolicy ?? allowAllPluginPolicy;
    const senderId = body.user_id ?? body.sender?.user_id;
    const selfId = dependencies.getSelfId?.() ?? getLoginUserId() ?? body.self_id;
    if (typeof senderId === "number" && senderId === selfId) {
        return;
    }
    if (!isWhitelisted(body)) {
        return;
    }

    const sourceMessageId = body.message_id === undefined || body.message_id === null
        ? `event:${body.post_type}:${body.time}:${randomUUID()}`
        : String(body.message_id);
    const auditId = randomUUID();
    const inserted = store.createInbound({
        auditId,
        sourceMessageId,
        selfAccountId: selfId,
        chatType: body.message_type,
        chatId: getChatId(body),
        actorUserId: senderId,
        occurredAt: body.time,
    });

    if (!inserted) {
        logger.info({ messageId: body.message_id }, "Ignored duplicate inbound message");
        return;
    }

    await runWithAuditContext({ auditId, source: "inbound" }, async () => {
        try {
            const data = await flatten(body);
            if (!data) {
                store.finishInbound(auditId, "empty");
                return;
            }

            for (const registration of plugins) {
                if (!pluginPolicy.isEnabled(registration.name, "invoke", body)) {
                    continue;
                }
                if (!registration.plugin.acceptMessage(data.text, body)) {
                    continue;
                }

                const runId = store.startPluginRun(
                    auditId,
                    registration.name,
                    Boolean(registration.excludeFromAuditStats),
                );
                if (registration.excludeFromAuditStats) {
                    store.excludeInbound(auditId);
                }
                try {
                    await runWithAuditContext({
                        pluginName: registration.name,
                        excludeFromStats: registration.excludeFromAuditStats,
                    }, () => registration.plugin(body, data));
                    store.finishPluginRun(runId, "succeeded");
                    store.finishInbound(auditId, "handled", registration.name);
                } catch (error) {
                    store.finishPluginRun(runId, "failed", error);
                    store.finishInbound(auditId, "failed", registration.name, error);
                    logger.error({ error, plugin: registration.name, auditId }, "Plugin execution failed");
                }
                return;
            }

            for (const registration of plugins) {
                if (!registration.plugin.observeMessage
                    || !pluginPolicy.isEnabled(registration.name, "observe", body)) {
                    continue;
                }
                try {
                    await runWithAuditContext({ pluginName: registration.name }, () => (
                        registration.plugin.observeMessage?.(body, data)
                    ));
                } catch (error) {
                    logger.error({ error, plugin: registration.name, auditId }, "Plugin observer failed");
                }
            }
            store.finishInbound(auditId, "unhandled");
        } catch (error) {
            store.finishInbound(auditId, "failed", undefined, error);
            logger.error({ error, auditId }, "Inbound message processing failed");
        }
    });
}
