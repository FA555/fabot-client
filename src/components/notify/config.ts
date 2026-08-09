export interface EmergencyConfig {
    webhookBase: string;
    allowedUserIds: ReadonlySet<number>;
    targetUserId?: number;
}

function parseUserId(value: string, variableName: string): number {
    const id = Number(value.trim());
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`${variableName} contains an invalid user ID: ${value}`);
    }
    return id;
}

export function loadEmergencyConfig(env: NodeJS.ProcessEnv = process.env): EmergencyConfig | null {
    const webhookBase = env.EMERGENCY_WEBHOOK_BASE?.trim();
    const allowedIdsValue = env.EMERGENCY_ALLOWED_USER_IDS?.trim();
    if (!webhookBase || !allowedIdsValue) {
        return null;
    }

    const webhookUrl = new URL(webhookBase);
    if (webhookUrl.protocol !== "https:") {
        throw new Error("EMERGENCY_WEBHOOK_BASE must use HTTPS");
    }

    const allowedUserIds = new Set(
        allowedIdsValue.split(",").map(value => parseUserId(value, "EMERGENCY_ALLOWED_USER_IDS")),
    );
    const targetValue = env.EMERGENCY_TARGET_USER_ID?.trim();
    return {
        webhookBase: webhookUrl.toString().replace(/\/$/, ""),
        allowedUserIds,
        targetUserId: targetValue ? parseUserId(targetValue, "EMERGENCY_TARGET_USER_ID") : undefined,
    };
}
