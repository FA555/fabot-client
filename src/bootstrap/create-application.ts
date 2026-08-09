import type { AuditStore } from "../audit";
import { getAuditStore } from "../audit";
import cronComponent, { type CronJobInput } from "../components/cron/cron";
import { loadConfiguredTasks } from "../components/cron/tasks";
import { initLoginInfo } from "../login-info";
import { handleMessage } from "../message-handler";
import type { MessageBody } from "../model";
import type { RegisteredPlugin } from "../plugin";
import { plugins } from "../plugins";
import type { AppConfig } from "./config";
import { createHttpApp } from "./http-app";

interface Scheduler {
    register(task: CronJobInput): void;
    start(): void;
    stop(): void;
}

interface AppServer {
    stop(closeActiveConnections?: boolean): void | Promise<void>;
}

type HttpFetch = (request: Request) => Response | Promise<Response>;

interface ServerOptions {
    hostname: string;
    port: number;
    fetch: HttpFetch;
}

export interface ApplicationDependencies {
    store?: Pick<AuditStore, "close">;
    scheduler?: Scheduler;
    plugins?: RegisteredPlugin[];
    loadTasks?: () => Promise<CronJobInput[]>;
    initializeLogin?: () => Promise<void>;
    handleMessage?: (body: MessageBody, plugins: RegisteredPlugin[]) => Promise<void>;
    serve?: (options: ServerOptions) => AppServer;
}

export interface Application {
    start(): Promise<void>;
    stop(): Promise<void>;
    fetch: HttpFetch;
}

export function createApplication(
    config: AppConfig,
    dependencies: ApplicationDependencies = {},
): Application {
    const store = dependencies.store ?? getAuditStore();
    const scheduler = dependencies.scheduler ?? cronComponent;
    const registeredPlugins = dependencies.plugins ?? plugins;
    const loadTasks = dependencies.loadTasks ?? loadConfiguredTasks;
    const initializeLogin = dependencies.initializeLogin ?? initLoginInfo;
    const dispatchMessage = dependencies.handleMessage ?? handleMessage;
    const serve = dependencies.serve ?? (options => Bun.serve({
        hostname: options.hostname,
        port: options.port,
        fetch: options.fetch,
    }));
    const httpApp = createHttpApp({
        plugins: registeredPlugins,
        webhookToken: config.webhookToken,
        handleMessage: dispatchMessage,
    });

    let server: AppServer | null = null;
    let started = false;
    let stopped = false;

    return {
        fetch: httpApp.fetch,
        async start(): Promise<void> {
            if (started) {
                return;
            }
            if (stopped) {
                throw new Error("Application cannot be restarted after it has stopped");
            }

            const tasks = await loadTasks();
            for (const task of tasks) {
                scheduler.register(task);
            }
            scheduler.start();
            server = serve({ hostname: config.hostname, port: config.port, fetch: httpApp.fetch });
            started = true;
            await initializeLogin();
        },
        async stop(): Promise<void> {
            if (stopped) {
                return;
            }
            stopped = true;
            scheduler.stop();
            await server?.stop(false);
            store.close();
            server = null;
        },
    };
}
