import ai from "./components/ai/ai";
import audit from "./components/audit/audit";
import bilibili from "./components/bilibili/bilibili";
import byrbbs from "./components/byrbbs/byrbbs";
import echo from "./components/echo/echo";
import handle from "./components/handle/handle";
import help from "./components/help/help";
import leetcode from "./components/leetcode/leetcode";
import notify from "./components/notify/notify";
import oeis from "./components/oeis/oeis";
import typst from "./components/typst/typst";
import type { RegisteredPlugin } from "./plugin";

export const plugins: RegisteredPlugin[] = [
    { name: "audit", plugin: audit },
    { name: "help", plugin: help },
    { name: "echo", plugin: echo },
    { name: "handle", plugin: handle },
    { name: "byrbbs", plugin: byrbbs },
    { name: "bilibili", plugin: bilibili },
    { name: "typst", plugin: typst },
    { name: "oeis", plugin: oeis },
    { name: "notify", plugin: notify },
    { name: "leetcode", plugin: leetcode },
    { name: "ai", plugin: ai },
];
