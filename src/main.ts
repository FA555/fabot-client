import { createApplication } from "./bootstrap/create-application";
import { loadAppConfig } from "./bootstrap/config";
import logger from "./log";
import { PROXY_ENV_KEYS } from "./network";

function redactProxyUrl(value: string): string {
    try {
        const url = new URL(value);
        if (url.username || url.password) {
            url.username = "****";
            url.password = "";
        }
        return url.toString();
    } catch {
        return value;
    }
}

function logStartupConfig(hostname: string, port: number): void {
    logger.info({ hostname, port }, "Starting server");
    logger.info({
        napCatToken: process.env.NAPCAT_TOKEN ? "configured" : "not set",
        webhookToken: process.env.WEBHOOK_TOKEN ? "configured" : "not set",
        authBase: process.env.AUTH_BASE ? "configured" : "not set",
        authKey: process.env.AUTH_KEY ? "configured" : "not set",
    }, "Service configuration");

    const proxies = Object.fromEntries(PROXY_ENV_KEYS.flatMap(key => {
        const value = process.env[key]?.trim();
        return value ? [[key, redactProxyUrl(value)]] : [];
    }));
    logger.info({ proxies }, "Proxy configuration");
}

export async function main(): Promise<void> {
    const config = loadAppConfig();
    logStartupConfig(config.hostname, config.port);
    const application = createApplication(config);
    await application.start();

    let stopping = false;
    const stop = async (signal: string): Promise<void> => {
        if (stopping) {
            return;
        }
        stopping = true;
        logger.info({ signal }, "Stopping application");
        await application.stop();
    };
    process.once("SIGINT", () => { void stop("SIGINT"); });
    process.once("SIGTERM", () => { void stop("SIGTERM"); });
}

if (import.meta.main) {
    main().catch(error => {
        logger.fatal({ error }, "Application failed to start");
        process.exitCode = 1;
    });
}
