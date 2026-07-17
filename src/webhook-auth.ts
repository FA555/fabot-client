import { timingSafeEqual } from "node:crypto";

export function isWebhookAuthorized(
    authorization: string | undefined,
    token = process.env.WEBHOOK_TOKEN?.trim(),
): boolean {
    if (!token) {
        return true;
    }
    const encoder = new TextEncoder();
    const expected = encoder.encode(`Bearer ${token}`);
    const actual = encoder.encode(authorization ?? "");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
