import cron, { type ScheduledTask } from "node-cron";

import logger from "../../log";
import { runWithAuditContext } from "../../audit";

export type CronOperation = () => void | Promise<void>;

export interface CronJobInput {
    name: string;
    expression: string;
    operation: CronOperation;
    timezone?: string;
    enabled?: boolean;
}

interface RegisteredCronJob {
    input: CronJobInput;
    task: ScheduledTask;
}

export class CronComponent {
    private readonly jobs = new Map<string, RegisteredCronJob>();
    private started = false;

    register(input: CronJobInput): void {
        if (this.jobs.has(input.name)) {
            throw new Error(`Cron job '${input.name}' already exists.`);
        }

        if (!cron.validate(input.expression)) {
            throw new Error(`Invalid cron expression for '${input.name}': ${input.expression}`);
        }

        const task = cron.createTask(
            input.expression,
            async () => {
                try {
                    await runWithAuditContext({ pluginName: "cron", source: "cron" }, input.operation);
                } catch (error) {
                    logger.error({ error, job: input.name }, "Cron job failed");
                }
            },
            {
                timezone: input.timezone,
                name: input.name,
            },
        );

        const shouldStart = this.started && input.enabled !== false;
        if (shouldStart) {
            task.start();
        }

        this.jobs.set(input.name, { input, task });
        logger.info({ job: input.name, expression: input.expression }, "Cron job registered");
    }

    unregister(name: string): boolean {
        const job = this.jobs.get(name);
        if (!job) {
            return false;
        }

        job.task.stop();
        job.task.destroy();
        this.jobs.delete(name);
        logger.info({ job: name }, "Cron job unregistered");
        return true;
    }

    start(): void {
        if (this.started) {
            return;
        }

        this.started = true;
        for (const job of this.jobs.values()) {
            if (job.input.enabled !== false) {
                job.task.start();
            }
        }

        logger.info({ count: this.jobs.size }, "Cron component started");
    }

    stop(): void {
        if (!this.started) {
            return;
        }

        this.started = false;
        for (const job of this.jobs.values()) {
            job.task.stop();
        }

        logger.info({ count: this.jobs.size }, "Cron component stopped");
    }

    list(): Array<{ name: string; expression: string; enabled: boolean; timezone?: string }> {
        return Array.from(this.jobs.values()).map(({ input }) => ({
            name: input.name,
            expression: input.expression,
            enabled: input.enabled !== false,
            timezone: input.timezone,
        }));
    }
}

const cronComponent = new CronComponent();

export default cronComponent;
