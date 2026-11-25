import {
    OFFICIAL_ORIGIN,
    OfficialStopError,
    type OfficialFetch,
} from "./official-page";

type PageRequest = {
    url: string;
    method: "GET" | "POST" | "HEAD";
    body?: string;
    read: "none" | "text" | "bytes";
};

type RawPageResult = {
    status: number;
    contentType: string;
    bodyText?: string;
    bodyBase64?: string;
    networkError?: string;
};

/**
 * 跑在已经打开的官网标签页里。与扩展源码的源站判断保持同一条 origin。
 * 使用页面自己的 fetch，不读取 document.cookie，也不把地址拼到其他主机。
 */
function officialFetchInPage(request: PageRequest): Promise<RawPageResult> {
    const allowed = "https://kd.nsfc.cn";
    let target: URL;
    try {
        target = new URL(request.url, location.href);
    } catch {
        return Promise.resolve({
            status: 0,
            contentType: "",
            networkError: "bad-url",
        });
    }
    if (target.origin !== allowed) {
        return Promise.resolve({
            status: 0,
            contentType: "",
            networkError: "off-origin",
        });
    }
    return fetch(target.href, {
        method: request.method,
        credentials: "same-origin",
        headers: request.method === "POST"
            ? {
                accept: "application/json, text/plain, */*",
                "content-type": "application/x-www-form-urlencoded",
            }
            : undefined,
        body: request.method === "POST" ? request.body ?? null : undefined,
    }).then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        if (request.read === "none" || request.method === "HEAD") {
            return { status: response.status, contentType };
        }
        if (request.read === "text") {
            return {
                status: response.status,
                contentType,
                bodyText: await response.text(),
            };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        const step = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += step) {
            binary += String.fromCharCode(
                ...bytes.subarray(offset, offset + step),
            );
        }
        return {
            status: response.status,
            contentType,
            bodyBase64: btoa(binary),
        };
    }).catch((error: unknown) => ({
        status: 0,
        contentType: "",
        networkError: error instanceof Error
            ? error.message.slice(0, 120)
            : "network",
    }));
}

function decodeBase64(data: string): Uint8Array {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

/** 只向当前结题详情标签注入一次官网同源请求。 */
export function fetchFromOpenTab(tabId: number): OfficialFetch {
    return async (request) => {
        if (!request.url.startsWith(OFFICIAL_ORIGIN)) {
            throw new OfficialStopError(
                "拒绝离开 https://kd.nsfc.cn。未生成PDF。",
            );
        }
        let injected: Array<{ result?: RawPageResult }> = [];
        try {
            const execute = chrome.scripting.executeScript as unknown as (injection: {
                target: { tabId: number };
                world: "MAIN";
                func: (pageRequest: PageRequest) => Promise<RawPageResult>;
                args: [PageRequest];
            }) => Promise<Array<{ result?: RawPageResult }>>;
            injected = await execute({
                target: { tabId },
                world: "MAIN",
                func: officialFetchInPage,
                args: [request],
            });
        } catch (error) {
            return {
                status: 0,
                contentType: "",
                networkError: error instanceof Error ? error.name : "script",
            };
        }
        const result = injected[0]?.result;
        if (!result) {
            return { status: 0, contentType: "", networkError: "empty" };
        }
        if (result.networkError === "off-origin") {
            throw new OfficialStopError(
                "页面内请求离开了官网，已拒绝。未生成PDF。",
            );
        }
        return {
            status: result.status,
            contentType: result.contentType,
            bodyText: result.bodyText,
            bytes: result.bodyBase64
                ? decodeBase64(result.bodyBase64)
                : undefined,
            networkError: result.networkError,
        };
    };
}
