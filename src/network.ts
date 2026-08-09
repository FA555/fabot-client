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
    proxyMode?: ProxyMode;
}

interface BotAxiosConfig<D = any> extends AxiosRequestConfig<D> {
    proxyMode?: ProxyMode;
}

const DEFAULT_PROXY_MODE: ProxyMode = "none";

export function botFetch(input: RequestInfo | URL, init: BotFetchInit = {}): Promise<Response> {
    const { proxyMode = DEFAULT_PROXY_MODE, ...fetchInit } = init;
    const proxy = proxyMode === "env" ? resolveEnvProxy(input) : undefined;
    return fetch(input, proxy ? { ...fetchInit, proxy } : fetchInit);
}

async function request<T = any, R = AxiosResponse<T>, D = any>(
    config: BotAxiosConfig<D>,
    includeNapCatToken: boolean,
): Promise<R> {
    const { proxyMode = DEFAULT_PROXY_MODE, ...axiosConfig } = config;
    if (includeNapCatToken) {
        const token = process.env.NAPCAT_TOKEN?.trim();
        if (token) {
            axiosConfig.headers = axiosConfig.headers ?? {};
            axiosConfig.headers.Authorization = `Bearer ${token}`;
        }
    }

    if (proxyMode === "none") {
        axiosConfig.proxy = false;
    }

    return axios.request<T, R, D>(axiosConfig);
}

const napCatRequest = <T = any, R = AxiosResponse<T>, D = any>(config: BotAxiosConfig<D>): Promise<R> => {
    return request<T, R, D>(config, true);
};

const serviceRequest = <T = any, R = AxiosResponse<T>, D = any>(config: BotAxiosConfig<D>): Promise<R> => {
    return request<T, R, D>(config, false);
};

export const botAxios = Object.assign(napCatRequest, {
    get: <T = any, R = AxiosResponse<T>, D = any>(url: string, config: BotAxiosConfig<D> = {}): Promise<R> => {
        return napCatRequest<T, R, D>({ ...config, method: "GET", url });
    },
    post: <T = any, R = AxiosResponse<T>, D = any>(url: string, data?: D, config: BotAxiosConfig<D> = {}): Promise<R> => {
        return napCatRequest<T, R, D>({ ...config, method: "POST", url, data });
    },
});

export const serviceAxios = Object.assign(serviceRequest, {
    get: <T = any, R = AxiosResponse<T>, D = any>(url: string, config: BotAxiosConfig<D> = {}): Promise<R> => {
        return serviceRequest<T, R, D>({ ...config, method: "GET", url });
    },
    post: <T = any, R = AxiosResponse<T>, D = any>(url: string, data?: D, config: BotAxiosConfig<D> = {}): Promise<R> => {
        return serviceRequest<T, R, D>({ ...config, method: "POST", url, data });
    },
});

function getEnvValue(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = env[key]?.trim();
        if (value) {
            return value;
        }
    }
    return undefined;
}

function bypassesProxy(url: URL, noProxy: string | undefined): boolean {
    if (!noProxy) {
        return false;
    }

    const hostname = url.hostname.toLowerCase();
    return noProxy.split(",").some(entry => {
        const value = entry.trim().toLowerCase();
        if (!value) {
            return false;
        }
        if (value === "*") {
            return true;
        }

        const separator = value.lastIndexOf(":");
        const hasPort = separator > 0 && /^\d+$/.test(value.slice(separator + 1));
        const rawHost = hasPort ? value.slice(0, separator) : value;
        const expectedPort = hasPort ? value.slice(separator + 1) : undefined;
        if (expectedPort && expectedPort !== url.port) {
            return false;
        }

        const expectedHost = rawHost.startsWith(".") ? rawHost.slice(1) : rawHost;
        return hostname === expectedHost || hostname.endsWith(`.${expectedHost}`);
    });
}

export function resolveEnvProxy(
    input: RequestInfo | URL,
    env: NodeJS.ProcessEnv = process.env,
): string | undefined {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (bypassesProxy(url, getEnvValue(env, "NO_PROXY", "no_proxy"))) {
        return undefined;
    }
    if (url.protocol === "https:") {
        return getEnvValue(env, "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy");
    }
    if (url.protocol === "http:") {
        return getEnvValue(env, "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy");
    }
    return undefined;
}
