/**
 * 离线测试：不访问 kd.nsfc.cn，不使用图片代理，不读取浏览器会话。
 * 合成 PDF 只用内存中的 1×1 PNG。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageDimensionsFromData } from "image-dimensions";
import { projectImg2pdf } from "../src/pdf-build";
import {
    assertReportPagesComplete,
    parseUpstreamJson,
    pdfFilename,
    readImagePath,
    shouldRetryImageTask,
    shouldStopRetrying,
} from "../src/report-check";
import { ImgResultType, ProjectInfo } from "../src/types";

const PNG_1X1 = Uint8Array.from(
    Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
    ),
);

const info: ProjectInfo = {
    projectName: "示例/报告:名称",
    projectAdmin: "测试",
    conclusionAbstract: "摘要",
    projectKeywordC: "关键词",
};

function page(index: number, overrides: Partial<ImgResultType> = {}): ImgResultType {
    return {
        index,
        imageData: PNG_1X1,
        width: 1,
        height: 1,
        orientation: "p",
        ...overrides,
    };
}

describe("上游响应", () => {
    it("HTML 与 HTTP 503 会报出非 JSON", () => {
        assert.throws(
            () =>
                parseUpstreamJson(
                    503,
                    "text/html; charset=utf-8",
                    "<html>unavailable</html>",
                ),
            /上游返回非JSON响应 HTTP 503（text\/html）/,
        );
    });

    it("JSON 正文可以解析，缺图片地址时报状态码", () => {
        const payload = parseUpstreamJson(200, "application/json", '{"data":{}}');
        assert.deepEqual(payload, { data: {} });
        assert.throws(
            () => readImagePath(payload, 200),
            /上游JSON缺少图片地址 HTTP 200/,
        );
        assert.equal(readImagePath({ data: { url: "/a.png" } }, 200), "/a.png");
    });
});

describe("重试停止", () => {
    it("连续失败达到 3 次后停止，耗尽的图片任务不再重试", () => {
        assert.equal(shouldStopRetrying(2), false);
        assert.equal(shouldStopRetrying(3), true);
        assert.equal(shouldRetryImageTask(1), true);
        assert.equal(shouldRetryImageTask(0), false);
        assert.equal(shouldRetryImageTask(undefined), false);
    });
});

describe("页完整性", () => {
    it("缺页、空图、未知页数都拒绝，齐全时返回应有页数", () => {
        assert.throws(
            () => assertReportPagesComplete([], 0),
            /未能确认完整页数/,
        );
        assert.throws(
            () =>
                assertReportPagesComplete(
                    [{ index: 1, byteLength: 10, width: 1, height: 1 }],
                    3,
                ),
            /缺少 \[2\]/,
        );
        assert.throws(
            () =>
                assertReportPagesComplete(
                    [{ index: 1, byteLength: 0, width: 1, height: 1 }],
                    2,
                ),
            /无法解析 \[1\]/,
        );
        assert.equal(
            assertReportPagesComplete(
                [
                    { index: 2, byteLength: 8, width: 2, height: 3 },
                    { index: 1, byteLength: 8, width: 1, height: 1 },
                ],
                3,
            ),
            2,
        );
    });
});

describe("离线合成 PDF", () => {
    it("用内存图片测宽高，并合成两页 PDF", () => {
        const size = imageDimensionsFromData(PNG_1X1);
        assert.equal(size?.width, 1);
        assert.equal(size?.height, 1);

        const [filename, pdfUrl] = projectImg2pdf(
            info,
            [page(2), page(1)],
            3,
        );
        assert.equal(filename, "示例-报告-名称.pdf");
        assert.equal(pdfFilename("a/b"), "a-b.pdf");
        assert.match(pdfUrl, /^data:application\/pdf/i);
        const base64 = pdfUrl.split(",")[1] ?? "";
        const bytes = Buffer.from(base64, "base64");
        assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
        const pageObjects = bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g);
        assert.equal(pageObjects?.length, 2);
    });

    it("页不齐时不返回 PDF", () => {
        assert.throws(
            () => projectImg2pdf(info, [page(1)], 3),
            /已中止，未生成PDF/,
        );
    });
});
