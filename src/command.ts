interface CommandMatchOptions {
    allowOptions?: boolean;
}

export function matchesCommand(
    text: string,
    command: string,
    options: CommandMatchOptions = {},
): boolean {
    const trimmed = text.trimStart();
    if (trimmed === command) {
        return true;
    }
    const boundary = trimmed[command.length];
    return trimmed.startsWith(command)
        && (Boolean(boundary?.match(/\s/)) || (options.allowOptions === true && boundary === "."));
}
