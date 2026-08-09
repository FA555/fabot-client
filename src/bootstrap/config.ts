export interface AppConfig {
    hostname: string;
    port: number;
    webhookToken: string | null;
}

function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
    if (normalized === "localhost" || normalized === "::1") {
        return true;
    }
    const match = normalized.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    return Boolean(match && match.slice(1).every(part => Number(part) <= 255));
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const hostname = env.BOT_HOST?.trim() || "127.0.0.1";
    const portValue = env.BOT_PORT?.trim() || "55550";
    const port = Number(portValue);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new Error(`BOT_PORT must be an integer between 1 and 65535: ${portValue}`);
    }

    const webhookToken = env.WEBHOOK_TOKEN?.trim() || null;
    if (!isLoopbackHostname(hostname) && !webhookToken) {
        throw new Error("WEBHOOK_TOKEN is required when BOT_HOST is not a loopback address");
    }

    return { hostname, port, webhookToken };
}
