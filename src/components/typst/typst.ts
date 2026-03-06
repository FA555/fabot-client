import type { Message, MessageBody, TextMessageData } from "../../model";
import type { Plugin } from "../../plugin";

import { execa } from "execa";
import { chmod, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { makeTextMessage, sendReplyMessage } from "../../util";

interface TypstInvocation {
    mode: 'auto' | 'a4' | 'math';
    dev: boolean;
    help: boolean;
    payload: string;
}

class Workspace {
    static TEMPLATE_DIR = fileURLToPath(new URL("./template/", import.meta.url));

    private binaryName: string;
    private mode: 'auto' | 'a4' | 'math';
    private path: string = '';
    private ppi: number;
    private state: 'uninitialized' | 'initialized' | 'rendered' = 'uninitialized';
    private notes: string[] = [];

    constructor(binaryName: string, mode: 'auto' | 'a4' | 'math', ppi: number = 180) {
        this.binaryName = binaryName;
        this.mode = mode;
        this.ppi = ppi;
    }

    mainFile(): string {
        return join(this.path, "main.typ");
    }

    pushNote(note: string) {
        this.notes.push(note);
    }

    getNotes(): string {
        return this.notes.map(s => s.trim().replaceAll("src/components/typst/template", "")).join("\n\n").trim().replaceAll(/\n{3,}/g, "\n\n");
    }

    async init(content: string) {
        this.pushNote(`Using Typst ${await getTypstVersion(this.binaryName)}.`);

        this.path = await mkdtemp(Workspace.TEMPLATE_DIR);
        await chmod(this.path, 0o755);
        await copyFile(join(Workspace.TEMPLATE_DIR, "model.typ"), join(this.path, "model.typ"));
        await copyFile(join(Workspace.TEMPLATE_DIR, `${this.mode}.typ`), this.mainFile());
        await writeFile(
            this.mainFile(),
            (await readFile(this.mainFile(), "utf-8")).replace("{{body}}", content),
            "utf-8"
        );
        this.state = 'initialized';
    }

    async render() {
        if (this.state !== 'initialized')
            throw new Error("WorkDirectory must be initialized before running.");

        const { stderr } = await execa(this.binaryName, [
            "compile",
            "--root", `${this.path}/`,
            "--ppi", this.ppi.toString(),
            this.mainFile(),
            join(this.path, "{0p}.png"),
        ], { reject: false });
        this.notes.push(stderr);

        this.state = 'rendered';
    }

    async getPages(): Promise<string[]> {
        if (this.state !== 'rendered')
            throw new Error("WorkDirectory must be rendered before getting pages.");

        return (await readdir(this.path))
            .filter(fileName => fileName.endsWith(".png"))
            .sort((l, r) => Number.parseInt(l, 10) - Number.parseInt(r, 10))
            .map(fileName => join(this.path, fileName));
    }

    async cleanup() {
        await rm(this.path, { recursive: true, force: true });
    }
}

const COMMAND_PREFIX = "/typst";

function acceptsCommand(text: string): boolean {
    return text.trimStart().startsWith(COMMAND_PREFIX);
}

function parseInvocation(text: string): TypstInvocation | null {
    if (!acceptsCommand(text))
        return null;

    let remainder = text.trimStart().slice(COMMAND_PREFIX.length).trimStart();
    if (remainder.length === 0)
        return null;

    const invocation: TypstInvocation = {
        mode: 'auto',
        dev: false,
        help: false,
        payload: "",
    };

    while (remainder.startsWith('.')) {
        const match = remainder.match(/^(\.[a-zA-Z0-9]+)\b/);
        if (!match)
            break;

        const flag = match[1].toLowerCase();
        if (flag === '.a4') {
            invocation.mode = 'a4';
        } else if (flag === '.math') {
            invocation.mode = 'math';
        } else if (flag === '.help') {
            invocation.help = true;
        } else if (flag === '.dev') {
            invocation.dev = true;
        } else {
            break;
        }

        remainder = remainder.slice(match[0].length).trimStart();
    }

    invocation.payload = remainder.trim();
    return invocation;
}

async function getTypstVersion(binaryName: string): Promise<string> {
    const defaultVersion = "(unknown version)";
    try {
        const { stdout } = await execa(binaryName, ["--version"]);
        const versionNumber = stdout.trim().match(/\d+\.\d+\.\d+/)?.[0] || defaultVersion;
        const versionHash = stdout.trim().match(/[0-9a-f]{8}/)?.[0] || null;
        return `${versionNumber}` + (versionHash ? ` (${versionHash})` : "");
    } catch (error) {
        console.error("Failed to get Typst version:", error);
        return defaultVersion;
    }
}

async function renderToDir(binaryName: string, mode: 'auto' | 'a4' | 'math', content: string): Promise<Workspace> {
    const ws = new Workspace(binaryName, mode);
    try {
        await ws.init(content);
        await ws.render();
        return ws;
    } catch (error) {
        await ws.cleanup();
        throw error;
    }
}

async function dirToBuffers(ws: Workspace): Promise<Message[]> {
    let pageFiles = await ws.getPages();
    if (pageFiles.length > 3) {
        ws.pushNote(`输出页数（${pageFiles.length} 页）太多了！已经截断为前 3 页。`);
        pageFiles = pageFiles.slice(0, 3);
    }
    return Promise.all(pageFiles.map(async file => ({ type: "image", data: { file: `base64://${await readFile(file, 'base64')}` } })));
}

const typst = (async (body: MessageBody, data: TextMessageData) => {
    const invocation = parseInvocation(data.text);
    if (!invocation)
        return;

    if (invocation.help) {
        await sendReplyMessage(body, [makeTextMessage(`Unimplemented`)]);
        return;
    }

    const binaryName = invocation.dev ? "typstb" : "typst";
    const ws = await renderToDir(binaryName, invocation.mode, invocation.payload);
    const buffer = await dirToBuffers(ws);
    await sendReplyMessage(body, [
        makeTextMessage(ws.getNotes()),
        ...buffer,
    ]);
    await ws.cleanup();
}) as Plugin;

typst.acceptMessage = acceptsCommand;

export default typst;
