export type InboundOutcome =
    | "received"
    | "ignored_self"
    | "not_whitelisted"
    | "empty"
    | "unhandled"
    | "handled"
    | "failed";

export type AuditStatus = "started" | "succeeded" | "failed";

export interface AuditContext {
    auditId?: string;
    pluginName?: string;
    source?: string;
    excludeFromStats?: boolean;
}

export interface InboundEventInput {
    auditId: string;
    sourceMessageId: string;
    selfAccountId?: number;
    chatType?: "private" | "group";
    chatId?: number;
    actorUserId?: number;
    occurredAt?: number;
}

export interface OutboundDeliveryInput {
    auditId?: string;
    pluginName?: string;
    source: string;
    messageKind: "message" | "reply";
    chatType: "private" | "group";
    chatId?: number;
    replyToMessageId?: string;
    textLength: number;
    imageCount: number;
    segmentCount: number;
    status: "succeeded" | "failed";
    napcatMessageId?: string;
    httpStatus?: number;
    retcode?: number;
    durationMs: number;
    errorCode?: string;
    excludeFromStats?: boolean;
}

export interface AiRequestInput {
    auditId?: string;
    pluginName?: string;
    modelKey: string;
    model: string;
    search: boolean;
    status: "succeeded" | "failed";
    attempts: number;
    durationMs: number;
    promptLength: number;
    responseLength?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    errorCode?: string;
    excludeFromStats?: boolean;
}

export interface AuditOverview {
    inboundMessages: number;
    validMessages: number;
    activeUsers: number;
    featureActiveUsers: number;
    featureInvocations: number;
    respondedMessages: number;
    outboundMessages: number;
    aiGenerations: number;
    aiAnswers: number;
    pluginFailures: number;
    deliveryFailures: number;
    aiFailures: number;
}

export interface PluginStats {
    pluginName: string;
    invocations: number;
    respondedMessages: number;
    outboundMessages: number;
    failures: number;
}

export interface AiStats {
    modelKey: string;
    requests: number;
    generations: number;
    answers: number;
    failures: number;
    retries: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    averageDurationMs: number;
}
