import { afterEach, describe, expect, test } from "bun:test";
import type { AxiosAdapter } from "axios";

import { botAxios, resolveEnvProxy, serviceAxios } from "./network";

const originalToken = process.env.NAPCAT_TOKEN;

afterEach(() => {
    if (originalToken === undefined) {
        delete process.env.NAPCAT_TOKEN;
    } else {
        process.env.NAPCAT_TOKEN = originalToken;
    }
});

describe("network clients", () => {
    test("selects environment proxies without mutating the environment", () => {
        const env = {
            HTTPS_PROXY: "http://secure-proxy:8080",
            HTTP_PROXY: "http://proxy:8080",
            NO_PROXY: "localhost,.internal.example",
        };

        expect(resolveEnvProxy("https://example.com", env)).toBe("http://secure-proxy:8080");
        expect(resolveEnvProxy("http://example.com", env)).toBe("http://proxy:8080");
        expect(resolveEnvProxy("https://api.internal.example", env)).toBeUndefined();
        expect(env).toEqual({
            HTTPS_PROXY: "http://secure-proxy:8080",
            HTTP_PROXY: "http://proxy:8080",
            NO_PROXY: "localhost,.internal.example",
        });
    });

    test("adds the NapCat token only to the NapCat client", async () => {
        process.env.NAPCAT_TOKEN = "test-token";
        let botAuthorization: unknown;
        let serviceAuthorization: unknown;
        const adapter = (capture: (authorization: unknown) => void): AxiosAdapter => async config => {
            capture(config.headers.get("Authorization"));
            return { data: {}, status: 200, statusText: "OK", headers: {}, config };
        };

        await botAxios.get("http://localhost/bot", {
            adapter: adapter(value => { botAuthorization = value; }),
        });
        await serviceAxios.get("http://localhost/service", {
            adapter: adapter(value => { serviceAuthorization = value; }),
        });

        expect(botAuthorization).toBe("Bearer test-token");
        expect(serviceAuthorization).toBeUndefined();
    });
});
