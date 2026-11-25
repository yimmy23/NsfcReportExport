/**
 * 官网直连的纯判断：不发请求，不读 Cookie，不把地址交给其他主机。
 */

export const EXTENSION_VERSION = "1.5.2";
export const OFFICIAL_ORIGIN = "https://kd.nsfc.cn";
export const PAGE_INTERVAL_MS = 1500;

export type OfficialRequest = {
    url: string;
    method: "GET" | "POST" | "HEAD";
    body?: string;
    read: "none" | "text" | "bytes";
};

export type OfficialResponse = {
    status: number;
    contentType: string;
    bodyText?: string;
    bytes?: Uint8Array;
    networkError?: string;
};

export type OfficialFetch = (request: OfficialRequest) => Promise<OfficialResponse>;

export class OfficialStopError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OfficialStopError";
    }
}

/** 可以有限次重试。耗尽后仍不得当成最后一页。 */
export class OfficialRetryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OfficialRetryError";
    }
}

export function isOfficialStop(error: unknown): boolean {
    return error instanceof Error && error.name === "OfficialStopError";
}

export function isFinalDetailsUrl(raw: string | undefined): boolean {
    if (!raw) return false;
    try {
        const url = new URL(raw);
        const id = url.searchParams.get("id");
        return url.origin === OFFICIAL_ORIGIN &&
            url.pathname.startsWith("/finalDetails") &&
            id != null && id.length > 0;
    } catch {
        return false;
    }
}

/** 只接受官网源站。绝对地址若指向别处，直接拒绝。 */
export function resolveOfficialUrl(pathOrUrl: string): string {
    const url = new URL(pathOrUrl, OFFICIAL_ORIGIN);
    if (url.protocol !== "https:" || url.origin !== OFFICIAL_ORIGIN) {
        throw new OfficialStopError(
            "官网给出的地址不在 https://kd.nsfc.cn，已拒绝，避免把页地址或图片发给其他主机。未生成PDF。",
        );
    }
    return url.href;
}

export type ImageProbe =
    | { kind: "page" }
    | { kind: "missing" }
    | { kind: "access" }
    | { kind: "retryable" };

/**
 * 只有图片请求明确返回 HTTP 404 才表示没有这一页。
 * 网络失败、403、网页验证和 5xx 都不是末页。
 */
export function classifyImageProbe(
    status: number,
    contentType: string | null,
    networkError?: string,
): ImageProbe {
    if (networkError || status === 0) return { kind: "retryable" };
    if (status === 404) return { kind: "missing" };
    if (isAccessControl(status, contentType)) return { kind: "access" };
    if (status === 200) return { kind: "page" };
    return { kind: "retryable" };
}

export function isAccessControl(
    status: number,
    contentType: string | null,
): boolean {
    const kind = (contentType || "").split(";")[0].trim().toLowerCase();
    return status === 401 || status === 403 || kind === "text/html";
}

export function accessStopMessage(status: number): string {
    return `官网拒绝继续读取 HTTP ${status}。请留在当前结题详情页，完成官网自己的验证后再点扩展。扩展不会代为通过验证。这不是最后一页，未生成PDF。`;
}

export function notLastPageMessage(index: number, detail: string): string {
    const where = index > 0 ? `第${index}页` : "读取";
    return `${where}没有按“页面不存在”结束（${detail}）。网络错误、拒绝访问和其他状态都不是最后一页。已中止，未生成PDF。`;
}

export type ExportPageRecord = {
    index: number;
    byteLength: number;
    sha256: string;
    width: number;
    height: number;
};

export type ExportManifest = {
    extensionVersion: typeof EXTENSION_VERSION;
    thirdPartyImageProxy: false;
    officialOrigin: typeof OFFICIAL_ORIGIN;
    sourcePage: string;
    projectName: string;
    projectAdmin: string;
    conclusionAbstract: string;
    projectKeywordC: string;
    pageCount: number;
    terminalIndex: number;
    pages: ExportPageRecord[];
    exportedAt: string;
    note: string;
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");
}

export function buildExportManifest(input: {
    sourcePage: string;
    projectName: string;
    projectAdmin: string;
    conclusionAbstract: string;
    projectKeywordC: string;
    terminalIndex: number;
    pages: ExportPageRecord[];
    exportedAt: string;
}): ExportManifest {
    return {
        extensionVersion: EXTENSION_VERSION,
        thirdPartyImageProxy: false,
        officialOrigin: OFFICIAL_ORIGIN,
        sourcePage: input.sourcePage,
        projectName: input.projectName,
        projectAdmin: input.projectAdmin,
        conclusionAbstract: input.conclusionAbstract,
        projectKeywordC: input.projectKeywordC,
        pageCount: input.pages.length,
        terminalIndex: input.terminalIndex,
        pages: input.pages,
        exportedAt: input.exportedAt,
        note: "字节只在浏览器内从官网当前页读取。本文件不含 Cookie，也不含图片 URL。",
    };
}

export function manifestFilename(projectName: string): string {
    return `${projectName}.nsfc-export.json`.replace(/[/\\?%*:|"<>]/g, "-");
}
