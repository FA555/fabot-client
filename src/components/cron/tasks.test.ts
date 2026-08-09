import { describe, expect, test } from "bun:test";

import { loadConfiguredTasks } from "./tasks";

describe("loadConfiguredTasks", () => {
    test("returns an empty list when the optional default module is absent", async () => {
        expect(await loadConfiguredTasks(undefined, "missing/default-tasks.ts")).toEqual([]);
    });

    test("fails when an explicitly configured module is absent", async () => {
        await expect(loadConfiguredTasks("missing/configured-tasks.ts")).rejects.toThrow(
            "Configured cron task module does not exist",
        );
    });
});
