/**
 * 离线测试：不访问 kd.nsfc.cn。假响应只留在进程内。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readReportPage } from "../src/nsfc";
import {
    OFFICIAL_ORIGIN,
    accessStopMessage,
    buildExportManifest,
    classifyImageProbe,
    isFinalDetailsUrl,
    manifestFilename,
    resolveOfficialUrl,
    sha256Hex,
} from "../src/official-page";
import { OfficialFetch, OfficialStopError } from "../src/official-page";

const PNG_1X1 = Uint8Array.from(
    Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
    ),
);

const FORBIDDEN_HOSTS = [
    "sogoucdn",
    "wsrv.nl",
    "weserv.nl",
    "trace.moe",
    "noobzone",
    "99z.top",
    "zme.ink",
    "2sb.org",
    "cdnjson",
    "npee.cn",
];

function listSources(dir: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) files.push(...listSources(path));
        else if (path.endsWith(".ts") || path.endsWith(".json")) files.push(path);
    }
    return files;
}

describe("只留在官网", () => {
    it("拒绝把页地址指到其他主机", () => {
        assert.equal(
            resolveOfficialUrl("/finalDetails/page.png"),
            `${OFFICIAL_ORIGIN}/finalDetails/page.png`,
        );
        assert.throws(
            () => resolveOfficialUrl("https://example.test/page.png"),
            OfficialStopError,
        );
        assert.equal(
            isFinalDetailsUrl("https://kd.nsfc.cn/finalDetails?id=22205143"),
            true,
        );
        assert.equal(
            isFinalDetailsUrl("https://example.test/finalDetails?id=22205143"),
            false,
        );
    });

    it("源码和清单不再包含第三方图片代理", () => {
        const manifest = readFileSync("extension/manifest.json", "utf8");
        assert.match(manifest, /"version": "1.5.3"/);
        assert.match(manifest, /国自然结题报告下载 直连诊断/);
        assert.doesNotMatch(manifest, /externally_connectable/);
        const bundle = [
            manifest,
            ...listSources("src").map((path) => readFileSync(path, "utf8")),
        ].join("\n");
        for (const host of FORBIDDEN_HOSTS) {
            assert.equal(bundle.includes(host), false, host);
        }
    });
});

describe("404 才是缺页", () => {
    it("网络错误、403 和 503 都不是末页", () => {
        assert.equal(classifyImageProbe(404, "text/html").kind, "missing");
        assert.equal(classifyImageProbe(0, "", "Failed to fetch").kind, "retryable");
        assert.equal(classifyImageProbe(403, "text/html").kind, "access");
        assert.equal(classifyImageProbe(503, "text/html").kind, "access");
        assert.equal(classifyImageProbe(503, "application/json").kind, "retryable");
        assert.match(accessStopMessage(403), /不会代为通过验证/);
        assert.match(accessStopMessage(403), /不是最后一页/);
    });

    it("假官网只被请求同源地址，403 立即停止", async () => {
        const seen: string[] = [];
        const fetchImpl: OfficialFetch = async (request) => {
            seen.push(request.url);
            assert.equal(new URL(request.url).origin, OFFICIAL_ORIGIN);
            if (request.method === "POST") {
                return {
                    status: 200,
                    contentType: "application/json",
                    bodyText: JSON.stringify({ data: { url: "/files/1.png" } }),
                };
            }
            return { status: 403, contentType: "text/html", bodyText: "<html>" };
        };
        await assert.rejects(
            () => readReportPage(fetchImpl, "22205143", 1),
            /不会代为通过验证/,
        );
        assert.deepEqual(seen, [
            `${OFFICIAL_ORIGIN}/api/baseQuery/completeProjectReport`,
            `${OFFICIAL_ORIGIN}/files/1.png`,
        ]);
    });

    it("图片 HTTP 404 结束，不会去取正文", async () => {
        const methods: string[] = [];
        const fetchImpl: OfficialFetch = async (request) => {
            methods.push(request.method);
            if (request.method === "POST") {
                return {
                    status: 200,
                    contentType: "application/json",
                    bodyText: JSON.stringify({ data: { url: "https://kd.nsfc.cn/files/9.png" } }),
                };
            }
            return { status: 404, contentType: "text/plain" };
        };
        const page = await readReportPage(fetchImpl, "22205143", 4);
        assert.deepEqual(page, { kind: "missing" });
        assert.deepEqual(methods, ["POST", "HEAD"]);
    });

    it("503 不会被当成缺页", async () => {
        const fetchImpl: OfficialFetch = async (request) => {
            if (request.method === "POST") {
                return {
                    status: 200,
                    contentType: "application/json",
                    bodyText: JSON.stringify({ data: { url: "/files/1.png" } }),
                };
            }
            return { status: 503, contentType: "application/json" };
        };
        await assert.rejects(
            () => readReportPage(fetchImpl, "22205143", 2),
            (error: Error) => {
                assert.equal(error.name, "OfficialRetryError");
                assert.match(error.message, /503/);
                return true;
            },
        );
    });
});

describe("归档清单", () => {
    it("记录来源和每页 SHA256，并声明没有第三方代理", async () => {
        const digest = await sha256Hex(PNG_1X1);
        const manifest = buildExportManifest({
            sourcePage: "https://kd.nsfc.cn/finalDetails?id=22205143",
            projectName: "示例/报告",
            projectAdmin: "测试 单位",
            conclusionAbstract: "摘要",
            projectKeywordC: "关键词",
            terminalIndex: 2,
            pages: [{
                index: 1,
                byteLength: PNG_1X1.byteLength,
                sha256: digest,
                width: 1,
                height: 1,
            }],
            exportedAt: "2026-11-25T00:00:00.000Z",
        });
        assert.equal(manifest.thirdPartyImageProxy, false);
        assert.equal(manifest.extensionVersion, "1.5.3");
        assert.equal(manifest.pageCount, 1);
        assert.equal(manifest.pages[0].sha256, digest);
        assert.equal(manifestFilename("示例/报告"), "示例-报告.nsfc-export.json");
        assert.equal(Object.hasOwn(manifest, "cookie"), false);
    });
});
