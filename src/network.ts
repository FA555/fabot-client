import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

export type ProxyMode = "none" | "env";

export const PROXY_ENV_KEYS = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
] as const;

interface BotFetchInit extends RequestInit {
    proxy?: ProxyMode;
}

interface BotAxiosConfig<D = any> extends AxiosRequestConfig<D> {
    proxyMode?: ProxyMode;
}

const DEFAULT_PROXY_MODE: ProxyMode = "none";

export function botFetch(input: RequestInfo | URL, init: BotFetchInit = {}): Promise<Response> {
    const { proxy = DEFAULT_PROXY_MODE, ...fetchInit } = init;
    if (proxy !== "none") {
        return fetch(input, fetchInit);
    }

    return withoutEnvProxy(() => fetch(input, fetchInit));
}

async function request<T = any, R = AxiosResponse<T>, D = any>(config: BotAxiosConfig<D>): Promise<R> {
    const { proxyMode = DEFAULT_PROXY_MODE, ...axiosConfig } = config;
    axiosConfig.headers = axiosConfig.headers ?? {};
    axiosConfig.headers.Authorization = `Bearer ${process.env.NAPCAT_TOKEN}`;

    if (proxyMode === "none") {
        axiosConfig.proxy = false;
    }

    return axios.request<T, R, D>(axiosConfig);
}

export const botAxios = Object.assign(request, {
    get: <T = any, R = AxiosResponse<T>, D = any>(url: string, config: BotAxiosConfig<D> = {}): Promise<R> => {
        return request<T, R, D>({ ...config, method: "GET", url });
    },
    post: <T = any, R = AxiosResponse<T>, D = any>(url: string, data?: D, config: BotAxiosConfig<D> = {}): Promise<R> => {
        return request<T, R, D>({ ...config, method: "POST", url, data });
    },
});

async function withoutEnvProxy<T>(fn: () => Promise<T>): Promise<T> {
    const previous = new Map<string, string | undefined>();

    for (const key of PROXY_ENV_KEYS) {
        previous.set(key, process.env[key]);
        delete process.env[key];
    }

    try {
        return await fn();
    } finally {
        for (const key of PROXY_ENV_KEYS) {
            const value = previous.get(key);
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}
