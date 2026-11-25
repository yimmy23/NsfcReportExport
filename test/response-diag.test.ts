/**
 * 离线模拟业务 JSON。不访问官网，断言诊断里不出现地址、编号和个人字段。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readReportPage } from "../src/nsfc";
import { OfficialFetch, OfficialStopError } from "../src/official-page";
import { diagnosePageJson, redactShortText } from "../src/response-diag";

const SECRET_NAME = "秘密课题名称甲";
const SECRET_URL = "https://evil.test/path?token=abcdef";
const SECRET_ID = "22205143";

function pageFetch(body: unknown, status = 200): OfficialFetch {
    return async (request) => {
        if (request.method === "POST") {
            return {
                status,
                contentType: "application/json; charset=utf-8",
                bodyText: JSON.stringify(body),
            };
        }
        throw new Error("不应继续请求图片");
    };
}

describe("脱敏", () => {
    it("去掉地址、长数字和过长正文", () => {
        const text = redactShortText(
            `请打开 ${SECRET_URL} 完成验证，编号 ${SECRET_ID}，联系 a@b.cn`,
        );
        assert.equal(text.includes(SECRET_URL), false);
        assert.equal(text.includes(SECRET_ID), false);
        assert.equal(text.includes("a@b.cn"), false);
        assert.match(text, /验证/);
        assert.ok(text.length <= 41);
    });
});

describe("HTTP 200 但没有 data.url", () => {
    it("立即停止并给出形状，不重试，不泄露嵌套字段", async () => {
        const payload = {
            code: 0,
            message: `见 ${SECRET_URL} 编号 ${SECRET_ID}`,
            data: { projectName: SECRET_NAME, projectAdmin: "张三" },
        };
        await assert.rejects(
            () => readReportPage(pageFetch(payload), "ignored", 1),
            (error: Error) => {
                assert.equal(error.name, "OfficialStopError");
                assert.match(error.message, /没有非空 data\.url/);
                assert.match(error.message, /HTTP 200/);
                assert.match(error.message, /application\/json/);
                assert.match(error.message, /code=0（语义未知）/);
                assert.match(error.message, /data是object但无url键/);
                assert.match(error.message, /未猜测其他字段/);
                assert.equal(error.message.includes(SECRET_NAME), false);
                assert.equal(error.message.includes(SECRET_URL), false);
                assert.equal(error.message.includes(SECRET_ID), false);
                assert.equal(error.message.includes("张三"), false);
                assert.equal(error instanceof OfficialStopError, true);
                return true;
            },
        );
    });

    it("空字符串是空值，null 的 data 与未结题文字分开描述", () => {
        const empty = diagnosePageJson(200, "application/json", {
            data: { url: "  " },
        });
        assert.match(empty ?? "", /存在但为空/);
        assert.doesNotMatch(empty ?? "", /没有非空 data\.url/);

        const unfinished = diagnosePageJson(200, "application/json", {
            code: 12,
            message: "该项目未结题",
            data: null,
        });
        assert.match(unfinished ?? "", /写明未结题/);
        assert.match(unfinished ?? "", /不是 HTTP 404/);
        assert.match(unfinished ?? "", /data为null/);
    });

    it("顶层说明要求验证时停止，且不把 code 数字当成验证结论", async () => {
        await assert.rejects(
            () =>
                readReportPage(
                    pageFetch({
                        code: 401,
                        message: "请先完成滑动验证",
                        data: null,
                    }),
                    "ignored",
                    1,
                ),
            /需要验证或访问受限/,
        );
        const onlyCode = diagnosePageJson(200, "application/json", {
            code: 401,
            data: {},
        });
        assert.match(onlyCode ?? "", /code=401（语义未知）/);
        assert.doesNotMatch(onlyCode ?? "", /需要验证或访问受限/);
    });
});
