/**
 * 只描述 JSON 的形状和现有 data.url。不输出地址、Cookie、请求头或报告字段的值。
 */

export type UrlFieldState =
    | "present"
    | "empty"
    | "nonstring"
    | "missing-key"
    | "data-null"
    | "data-other"
    | "no-data";

export type BusinessKind = "access" | "unfinished" | "empty" | "missing" | "ok";

const ACCESS_TEXT = /验证|captcha|滑动|登录|权限|禁止|未授权|访问受限/i;
const UNFINISHED_TEXT = /未结题|未结项|尚未结题/;

export function valueKind(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    const kind = typeof value;
    if (
        kind === "string" || kind === "number" || kind === "boolean" ||
        kind === "object"
    ) {
        return kind;
    }
    return "other";
}

export function topLevelShape(payload: unknown): string {
    if (payload === null) return "null";
    if (Array.isArray(payload)) return "array";
    if (typeof payload !== "object") return valueKind(payload);
    const record = payload as Record<string, unknown>;
    const parts = Object.keys(record).sort().map((key) =>
        `${key}:${valueKind(record[key])}`
    );
    return parts.length > 0 ? parts.join(",") : "object(无键)";
}

/** 只看现有结构 data.url，不读取其他嵌套字段。 */
export function urlFieldState(payload: unknown): UrlFieldState {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return "no-data";
    }
    const record = payload as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, "data")) return "no-data";
    const data = record.data;
    if (data === null) return "data-null";
    if (typeof data !== "object" || Array.isArray(data)) return "data-other";
    if (!Object.prototype.hasOwnProperty.call(data, "url")) return "missing-key";
    const url = (data as Record<string, unknown>).url;
    if (url === null) return "empty";
    if (typeof url !== "string") return "nonstring";
    if (url.trim().length === 0) return "empty";
    return "present";
}

export function redactShortText(value: string): string {
    const cleaned = value
        .replace(/https?:\/\/\S+/gi, "[url]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
        .replace(/\b[A-Fa-f0-9]{16,}\b/g, "[hex]")
        .replace(/\d{6,}/g, "[num]")
        .replace(/\s+/g, " ")
        .trim();
    if (cleaned.length <= 40) return cleaned;
    return `${cleaned.slice(0, 40)}…`;
}

export function topLevelCode(payload: unknown): string {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return "无顶层code";
    }
    const record = payload as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, "code")) return "无顶层code";
    const code = record.code;
    if (typeof code === "number" && Number.isFinite(code)) {
        return `code=${code}（语义未知）`;
    }
    if (typeof code === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(code)) {
        return `code=${code}（语义未知）`;
    }
    return `code类型=${valueKind(code)}`;
}

export function topLevelMessage(payload: unknown): string | null {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }
    const record = payload as Record<string, unknown>;
    const raw = Object.prototype.hasOwnProperty.call(record, "message")
        ? record.message
        : Object.prototype.hasOwnProperty.call(record, "msg")
        ? record.msg
        : undefined;
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    return redactShortText(raw);
}

function urlStateText(state: UrlFieldState): string {
    switch (state) {
        case "present":
            return "data.url为非空字符串";
        case "empty":
            return "data.url存在但为空";
        case "nonstring":
            return "data.url不是字符串";
        case "missing-key":
            return "data是object但无url键";
        case "data-null":
            return "data为null";
        case "data-other":
            return "data不是object";
        case "no-data":
            return "无data键";
    }
}

export function classifyBusiness(payload: unknown): BusinessKind {
    const message = topLevelMessage(payload) ?? "";
    if (ACCESS_TEXT.test(message)) return "access";
    if (UNFINISHED_TEXT.test(message)) return "unfinished";
    const url = urlFieldState(payload);
    if (url === "present") return "ok";
    if (url === "empty") return "empty";
    return "missing";
}

export function diagnosePageJson(
    status: number,
    contentType: string,
    payload: unknown,
): string | null {
    const kind = classifyBusiness(payload);
    if (kind === "ok") return null;
    const shape = topLevelShape(payload);
    const code = topLevelCode(payload);
    const message = topLevelMessage(payload);
    const detail = [
        `HTTP ${status}`,
        contentType.split(";")[0].trim() || "无content-type",
        `顶层 ${shape}`,
        code,
        message ? `message=${message}` : "无顶层message",
        urlStateText(urlFieldState(payload)),
    ].join("；");
    if (kind === "access") {
        return `官网业务信息显示需要验证或访问受限。请在当前结题详情页完成官网自己的验证后再点一次。扩展不会更换接口，不会读取或改写凭据，也不会代为通过验证。这不是最后一页，未生成PDF。诊断：${detail}`;
    }
    if (kind === "unfinished") {
        return `官网顶层说明文字写明未结题。这只说明文字本身，不能据此判断权限。这不是 HTTP 404，也不是网络错误，未生成PDF。诊断：${detail}`;
    }
    if (kind === "empty") {
        return `现有结构里的 data.url 存在但为空。这是空值，不是缺少字段，也不是网络错误或最后一页。语义未知，未猜测其他字段，未生成PDF。诊断：${detail}`;
    }
    return `HTTP ${status} 的 JSON 已解析，但现有结构没有非空 data.url。语义未知，未猜测其他字段，未更换接口。这不是最后一页，未生成PDF。诊断：${detail}`;
}
