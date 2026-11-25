/**
 * 纯函数：上游响应是否可解析、页是否齐全、文件名是否可保存。
 * 不发起网络请求，也不读取浏览器会话。
 */

export const MAX_CONSECUTIVE_PAGE_ERRORS = 3;

export type PageImageCheck = {
    index?: number;
    byteLength: number;
    width?: number;
    height?: number;
};

export function parseUpstreamJson(
    status: number,
    contentType: string | null,
    body: string,
): unknown {
    try {
        return JSON.parse(body);
    } catch {
        const kind = contentType?.split(";")[0]?.trim() || "unknown";
        throw new Error(`上游返回非JSON响应 HTTP ${status}（${kind}）`);
    }
}

export function readImagePath(payload: unknown, status: number): string {
    const url = (payload as { data?: { url?: unknown } } | null)?.data?.url;
    if (typeof url !== "string" || url.length === 0) {
        throw new Error(`上游JSON缺少图片地址 HTTP ${status}`);
    }
    return url;
}

export function shouldStopRetrying(
    consecutiveErrors: number,
    max: number = MAX_CONSECUTIVE_PAGE_ERRORS,
): boolean {
    return consecutiveErrors >= max;
}

/** retryCount 已耗尽时再调用 retry() 会把失败回调递归打回去。 */
export function shouldRetryImageTask(retryCount: number | undefined): boolean {
    return (retryCount ?? 0) > 0;
}

export function pdfFilename(projectName: string): string {
    return `${projectName}.pdf`.replace(/[/\\?%*:|"<>]/g, "-");
}

function formatIndexes(indexes: number[]): string {
    const shown = indexes.slice(0, 20).join(",");
    if (indexes.length > 20) {
        return `${shown}…共${indexes.length}页`;
    }
    return shown || "无";
}

/**
 * 结束索引是首次返回 404 的页码，有效页为 1..terminalIndex-1。
 * 缺页、重复、空字节或无法解析宽高时抛错，调用方不得写 PDF。
 */
export function assertReportPagesComplete(
    pages: PageImageCheck[],
    terminalIndex: number,
): number {
    if (!Number.isInteger(terminalIndex) || terminalIndex < 2) {
        throw new Error(
            `未能确认完整页数（结束索引 ${terminalIndex}），已中止，未生成PDF`,
        );
    }
    const expected = terminalIndex - 1;
    const byIndex = new Map<number, PageImageCheck>();
    const duplicates: number[] = [];
    const unexpected: number[] = [];
    for (const page of pages) {
        if (page.index == null || !Number.isInteger(page.index)) {
            unexpected.push(-1);
            continue;
        }
        if (page.index < 1 || page.index > expected) {
            unexpected.push(page.index);
            continue;
        }
        if (byIndex.has(page.index)) {
            duplicates.push(page.index);
            continue;
        }
        byIndex.set(page.index, page);
    }
    const missing: number[] = [];
    const invalid: number[] = [];
    for (let index = 1; index <= expected; index++) {
        const page = byIndex.get(index);
        if (!page) {
            missing.push(index);
            continue;
        }
        if (
            page.byteLength <= 0 ||
            page.width == null || page.width <= 0 ||
            page.height == null || page.height <= 0
        ) {
            invalid.push(index);
        }
    }
    if (
        duplicates.length > 0 || unexpected.length > 0 ||
        missing.length > 0 || invalid.length > 0
    ) {
        throw new Error(
            `报告页面不完整：应有 ${expected} 页，缺少 [${
                formatIndexes(missing)
            }]，无法解析 [${formatIndexes(invalid)}]，重复 [${
                formatIndexes(duplicates)
            }]，越界 [${formatIndexes(unexpected)}]，已中止，未生成PDF`,
        );
    }
    return expected;
}
