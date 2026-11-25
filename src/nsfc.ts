import { imageDimensionsFromData } from "image-dimensions";
import { ImgResultType, ProjectInfo } from "./types";
import { parseUpstreamJson, readImagePath } from "./report-check";
import {
    OfficialFetch,
    OfficialRetryError,
    OfficialStopError,
    accessStopMessage,
    classifyImageProbe,
    isAccessControl,
    resolveOfficialUrl,
} from "./official-page";

const host = "https://kd.nsfc.cn";

async function readOfficialText(
    fetchImpl: OfficialFetch,
    url: string,
    method: "GET" | "POST" | "HEAD",
    body?: string,
): Promise<{ status: number; contentType: string; bodyText: string }> {
    const response = await fetchImpl({
        url,
        method,
        body,
        read: method === "HEAD" ? "none" : "text",
    });
    if (response.networkError || response.status === 0) {
        throw new OfficialRetryError(response.networkError || "没有 HTTP 状态");
    }
    return {
        status: response.status,
        contentType: response.contentType,
        bodyText: response.bodyText ?? "",
    };
}

function stopIfAccess(status: number, contentType: string): void {
    if (isAccessControl(status, contentType)) {
        throw new OfficialStopError(accessStopMessage(status || 403));
    }
}

export const readProjectInfo = async (
    fetchImpl: OfficialFetch,
    id: string,
): Promise<ProjectInfo> => {
    const response = await readOfficialText(
        fetchImpl,
        `${host}/api/baseQuery/conclusionProjectInfo/${encodeURIComponent(id)}`,
        "POST",
    );
    stopIfAccess(response.status, response.contentType);
    let data: {
        data?: {
            projectName?: string;
            projectAdmin?: string;
            dependUnit?: string;
            conclusionAbstract?: string;
            projectKeywordC?: string;
        };
    };
    try {
        data = parseUpstreamJson(
            response.status,
            response.contentType,
            response.bodyText,
        ) as typeof data;
    } catch (error) {
        throw new OfficialRetryError((error as Error).message);
    }
    if (response.status !== 200) {
        throw new OfficialRetryError(`项目信息 HTTP ${response.status}`);
    }
    return {
        projectName: data?.data?.projectName ?? "projectName",
        projectAdmin: (data?.data?.projectAdmin ?? "") + " " +
            (data?.data?.dependUnit ?? ""),
        conclusionAbstract: data?.data?.conclusionAbstract ?? "",
        projectKeywordC: data?.data?.projectKeywordC ?? "",
    };
};

export type ReportPage =
    | { kind: "missing" }
    | { kind: "page"; image: ImgResultType };

/**
 * 先向官网要这一页的地址，再在官同源上确认它是否存在，然后只从官网取字节。
 * HTTP 404 才是缺页。其他失败不会被当成最后一页。
 */
export const readReportPage = async (
    fetchImpl: OfficialFetch,
    id: string,
    index: number,
): Promise<ReportPage> => {
    const listed = await readOfficialText(
        fetchImpl,
        `${host}/api/baseQuery/completeProjectReport`,
        "POST",
        `id=${encodeURIComponent(id)}&index=${index}`,
    );
    stopIfAccess(listed.status, listed.contentType);
    if (listed.status !== 200) {
        throw new OfficialRetryError(`页地址 HTTP ${listed.status}`);
    }
    let payload: unknown;
    try {
        payload = parseUpstreamJson(
            listed.status,
            listed.contentType,
            listed.bodyText,
        );
    } catch (error) {
        throw new OfficialRetryError((error as Error).message);
    }
    let imagePath: string;
    try {
        imagePath = readImagePath(payload, listed.status);
    } catch (error) {
        throw new OfficialRetryError((error as Error).message);
    }
    const imageUrl = resolveOfficialUrl(imagePath);

    const probe = await fetchImpl({
        url: imageUrl,
        method: "HEAD",
        read: "none",
    });
    const decision = classifyImageProbe(
        probe.status,
        probe.contentType,
        probe.networkError,
    );
    const headUnsupported = probe.status === 405 || probe.status === 501;
    if (decision.kind === "missing") return { kind: "missing" };
    if (decision.kind === "access") {
        throw new OfficialStopError(accessStopMessage(probe.status || 403));
    }
    if (decision.kind === "retryable" && !headUnsupported) {
        throw new OfficialRetryError(
            probe.networkError || `图片探测 HTTP ${probe.status}`,
        );
    }

    const image = await fetchImpl({
        url: imageUrl,
        method: "GET",
        read: "bytes",
    });
    const imageDecision = classifyImageProbe(
        image.status,
        image.contentType,
        image.networkError,
    );
    if (imageDecision.kind === "missing") return { kind: "missing" };
    if (imageDecision.kind === "access") {
        throw new OfficialStopError(accessStopMessage(image.status || 403));
    }
    if (imageDecision.kind !== "page" || !image.bytes || image.bytes.byteLength === 0) {
        throw new OfficialRetryError(
            image.networkError || `图片正文 HTTP ${image.status}`,
        );
    }
    const kind = (image.contentType || "").split(";")[0].trim().toLowerCase();
    if (kind && !kind.startsWith("image/") && kind !== "application/octet-stream") {
        throw new OfficialRetryError(`图片内容类型 ${kind}`);
    }
    const size = imageDimensionsFromData(image.bytes);
    if (!size?.width || !size?.height) {
        throw new OfficialRetryError("官网返回的内容无法解析为图片");
    }
    return {
        kind: "page",
        image: {
            index,
            imageData: image.bytes,
            width: size.width,
            height: size.height,
            orientation: size.width < size.height ? "p" : "l",
        },
    };
};
