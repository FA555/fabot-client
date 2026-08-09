import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import logger from "../../log";
import type { CronJobInput } from "./cron";

interface TaskModule {
    tasks?: unknown;
}

export async function loadConfiguredTasks(
    configuredPath = process.env.CRON_TASKS_PATH?.trim(),
    defaultPath = "config/hardcoded-tasks.ts",
): Promise<CronJobInput[]> {
    const path = resolve(configuredPath || defaultPath);
    if (!existsSync(path)) {
        if (configuredPath) {
            throw new Error(`Configured cron task module does not exist: ${path}`);
        }
        logger.info({ path }, "No optional cron task module found");
        return [];
    }

    const taskModule = await import(pathToFileURL(path).href) as TaskModule;
    if (!Array.isArray(taskModule.tasks)) {
        throw new Error(`Cron task module must export a tasks array: ${path}`);
    }
    return taskModule.tasks as CronJobInput[];
}
