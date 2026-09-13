import "dotenv/config";
import type {InputType, ModelType, RequestBody, ResponseSchema, ToolsType} from "./API/responses.ts";
import {logger} from "../logger.ts";



export class ModelClient {
    private readonly apiKey = process.env.DEEPSEEK_API_KEY;
    private readonly baseURL = "https://api.deepseek.com";

    constructor() {
        logger.info("new class ModelClient()");
    }

    public async requestResponsesAPI(
        model: ModelType,
        input: InputType,
        instructions: string,
        tools: ToolsType,
        user: string,
    ): Promise<ResponseSchema> {
        if (!this.apiKey) {
            throw new Error("未配置 DEEPSEEK_API_KEY，请先在 .env 中填写后再发送消息。");
        }

        const endPoint = "/responses";

        const requestBody: RequestBody = {
            model: model,
            input: input,
            instructions: instructions,
            tools: tools,
            user: user,
        }
        const requestBodyString = JSON.stringify(requestBody);

        const response = await fetch(
            `${this.baseURL}${endPoint}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`,
                },
                body: requestBodyString,
            }
        );

        const responseBody: unknown = await response.json();
        if (!response.ok) {
            throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）：${this.getErrorMessage(responseBody)}`);
        }

        return responseBody as ResponseSchema;
    }

    private getErrorMessage(responseBody: unknown): string {
        if (typeof responseBody !== "object" || responseBody === null) {
            return "服务未返回可读的错误信息";
        }

        const body = responseBody as Record<string, unknown>;
        if (typeof body.message === "string") {
            return body.message;
        }
        if (typeof body.error === "string") {
            return body.error;
        }
        if (typeof body.error === "object" && body.error !== null) {
            const error = body.error as Record<string, unknown>;
            if (typeof error.message === "string") {
                return error.message;
            }
        }
        return "服务未返回可读的错误信息";
    }
}
