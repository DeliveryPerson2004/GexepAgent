import {afterEach, beforeEach, describe, it, mock} from "node:test";
import assert from "node:assert/strict";
import {ModelClient} from "../src/backend/DeepSeek/ModelClient.ts";
import {ModelType, type ResponseSchema, type ToolsType} from "../src/backend/DeepSeek/API/responses.ts";


const fakeResponse: ResponseSchema = {
    id: "resp_test_1",
    object: "response",
    created_at: 1700000000,
    status: "completed",
    error: {},
    incomplete_details: {},
    model: "deepseek-flash",
    output: [
        {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{type: "output_text", text: "你好"}],
        },
    ],
    usage: {
        input_tokens: 10,
        input_tokens_details: {},
        output_tokens: 5,
        output_tokens_details: {},
        total_tokens: 15,
    },
};

describe("ModelClient", () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    beforeEach(() => {
        process.env.DEEPSEEK_API_KEY = "test-api-key";
        capturedUrl = undefined;
        capturedInit = undefined;

        mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
            capturedUrl = input.toString();
            capturedInit = init;
            return new Response(JSON.stringify(fakeResponse), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        });
    });

    afterEach(() => {
        mock.restoreAll();
    });

    it("向 /responses 端点发送 POST 请求", async () => {
        const client = new ModelClient();
        await client.requestResponsesAPI(
            ModelType.DeepSeekFlash,
            [{type: "message", role: "user", content: "hi"}],
            "instructions",
            [],
            "test_user",
        );

        assert.equal(capturedUrl, "https://api.deepseek.com/responses");
        assert.equal(capturedInit?.method, "POST");
    });

    it("携带正确的请求头（含 Bearer Token）", async () => {
        const client = new ModelClient();
        await client.requestResponsesAPI(ModelType.DeepSeekFlash, [], "instructions", [], "test_user");

        const headers = capturedInit?.headers as Record<string, string>;
        assert.equal(headers["Content-Type"], "application/json");
        assert.equal(headers["Accept"], "application/json");
        assert.equal(headers["Authorization"], "Bearer test-api-key");
    });

    it("请求体包含 model/input/instructions/tools/user", async () => {
        const client = new ModelClient();
        const tools: ToolsType = [
            {
                type: "function",
                name: "load_skill",
                description: "desc",
                parameters: {
                    "type": "object",
                    properties: {},
                    required: [],
                },
            },
        ];
        const input = [{type: "message" as const, role: "user" as const, content: "hello"}];

        await client.requestResponsesAPI(
            ModelType.DeepSeekFlash,
            input,
            "system instructions",
            tools,
            "test_user",
        );

        const body = JSON.parse(capturedInit?.body as string);
        assert.equal(body.model, ModelType.DeepSeekFlash);
        assert.deepEqual(body.input, input);
        assert.equal(body.instructions, "system instructions");
        assert.deepEqual(body.tools, tools);
        assert.equal(body.user, "test_user");
    });

    it("返回解析后的 JSON 响应", async () => {
        const client = new ModelClient();
        const result = await client.requestResponsesAPI(ModelType.DeepSeekFlash, [], "instructions", [], "test_user");

        assert.deepEqual(result, fakeResponse);
    });

    it("HTTP 错误会抛出可读的服务端信息", async () => {
        mock.restoreAll();
        mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
            error: {message: "invalid api key"},
        }), {
            status: 401,
            headers: {"Content-Type": "application/json"},
        }));

        const client = new ModelClient();
        await assert.rejects(
            client.requestResponsesAPI(ModelType.DeepSeekFlash, [], "instructions", [], "test_user"),
            /HTTP 401.*invalid api key/,
        );
    });

    it("ModelType.DeepSeekFlash 的值为 deepseek-flash", () => {
        assert.equal(ModelType.DeepSeekFlash, "deepseek-flash");
    });
});
