import {after, afterEach, describe, it, mock} from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
    InputFunctionCallItem,
    InputFunctionCallOutputItem,
    InputItemType,
    InputMessageItem,
} from "../src/backend/DeepSeek/API/responses.ts";
import type {AgentEvent} from "../src/backend/DeepSeek/Agents/BaseAgent.ts";


const SKILL_NAME = "从英语单词引申到外国名著片段";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deep-forge-test-"));
process.chdir(tempDir);

mock.method(console, "log", () => {});

process.env.DEEPSEEK_API_KEY = "test-api-key";

const {db} = await import("../src/backend/database/db.ts");
await import("../src/backend/database/initDatabase.ts");
const {
    selectIdFromAgentTableStmt,
    insertIntoMessageTableStmt,
    selectMessageFromMessageTableStmt,
} = await import("../src/backend/database/stmt.ts");
const {LexeyAgent} = await import("../src/backend/DeepSeek/Agents/Lexey/LexeyAgent.ts");

const dbAgentId = selectIdFromAgentTableStmt.get("Lexey") as number;


class TestableLexeyAgent extends LexeyAgent {
    public getInput(): InputItemType[] {
        return this.input;
    }

    public getAgentId(): number {
        return this.agentId;
    }

    public getAgentName(): string {
        return this.agentName;
    }

    public testRequestFunctionCall(item: InputFunctionCallItem): Promise<void> {
        return this.requestFunctionCall(item);
    }
}


function createFunctionCallItem(name: string, args: string): InputFunctionCallItem {
    return {
        type: "function_call",
        call_id: "call_1",
        name: name,
        arguments: args,
    };
}

function isFunctionCallOutputItem(item: InputItemType): item is InputFunctionCallOutputItem {
    return (item as {type?: string}).type === "function_call_output";
}

function isMessageItem(item: InputItemType): item is InputMessageItem {
    return (item as {type?: string}).type === "message";
}

function getLastOutputItem(input: InputItemType[]): InputFunctionCallOutputItem {
    const item = input[input.length - 1];
    assert.ok(item !== undefined, "input 应包含回填项");
    assert.ok(isFunctionCallOutputItem(item), "期望最后一个元素是 function_call_output");
    return item;
}

afterEach(() => {
    mock.restoreAll();
    mock.method(console, "log", () => {});
});

after(() => {
    db.close();
    fs.rmSync(tempDir, {recursive: true, force: true});
});

describe("LexeyAgent 构造函数", () => {
    it("从数据库读取 agentId 与 agentName", () => {
        const agent = new TestableLexeyAgent();
        assert.equal(agent.getAgentId(), dbAgentId);
        assert.equal(agent.getAgentName(), "Lexey");
    });

    it("从 message 表加载 is_activated = 1 的历史输入，并跳过非法 JSON", () => {
        insertIntoMessageTableStmt.run(dbAgentId, 1, JSON.stringify([{type: "message", role: "user", content: "历史标记-ACTIVE"}]), 1);
        insertIntoMessageTableStmt.run(dbAgentId, 2, JSON.stringify([{type: "message", role: "user", content: "历史标记-INACTIVE"}]), 0);
        insertIntoMessageTableStmt.run(dbAgentId, 3, "这不是合法JSON", 1);

        const input = new TestableLexeyAgent().getInput();

        assert.ok(input.some((item) => isMessageItem(item) && item.content === "历史标记-ACTIVE"));
        assert.ok(!input.some((item) => isMessageItem(item) && item.content === "历史标记-INACTIVE"));
    });
});

describe("LexeyAgent.requestFunctionCall()", () => {
    it("load_skill 正常调用后回填 function_call_output（含 skill 正文）", async () => {
        const agent = new TestableLexeyAgent();
        const before = agent.getInput().length;

        await agent.testRequestFunctionCall(createFunctionCallItem("load_skill", JSON.stringify({skillName: SKILL_NAME})));

        const input = agent.getInput();
        assert.equal(input.length, before + 1);

        const outputItem = getLastOutputItem(input);
        assert.equal(outputItem.call_id, "call_1");
        assert.equal(outputItem.name, "load_skill");
        assert.ok(outputItem.output.includes(`# ${SKILL_NAME}`));
        assert.ok(!outputItem.output.startsWith("---"));
    });

    it("load_skill arguments 不是合法 JSON 时回填解析失败信息", async () => {
        const agent = new TestableLexeyAgent();
        const before = agent.getInput().length;

        await agent.testRequestFunctionCall(createFunctionCallItem("load_skill", "not-json"));

        const input = agent.getInput();
        assert.equal(input.length, before + 1);
        assert.ok(getLastOutputItem(input).output.includes("参数解析失败"));
    });

    it("load_skill 参数 schema 校验失败时回填校验失败信息", async () => {
        const agent = new TestableLexeyAgent();
        const before = agent.getInput().length;

        await agent.testRequestFunctionCall(createFunctionCallItem("load_skill", JSON.stringify({skillName: 123})));

        const input = agent.getInput();
        assert.equal(input.length, before + 1);
        assert.ok(getLastOutputItem(input).output.includes("参数校验失败"));
    });

    it("未知工具名不回填", async () => {
        const agent = new TestableLexeyAgent();
        const before = agent.getInput().length;

        await agent.testRequestFunctionCall(createFunctionCallItem("unknown_tool", "{}"));

        assert.equal(agent.getInput().length, before);
    });
});

describe("LexeyAgent.ask() 全链路", () => {
    it("function_call 经工具执行回填后继续推理，直至无 function_call，并持久化 message", async () => {
        const responses = [
            {
                output: [
                    {
                        type: "function_call",
                        id: "fc_1",
                        status: "completed",
                        call_id: "call_1",
                        name: "load_skill",
                        arguments: JSON.stringify({skillName: SKILL_NAME}),
                    },
                ],
            },
            {
                output: [
                    {
                        type: "message",
                        id: "msg_1",
                        status: "completed",
                        role: "assistant",
                        content: [{type: "output_text", text: "done"}],
                    },
                ],
            },
        ];

        let callIndex = 0;
        const fetchMock = mock.method(globalThis, "fetch", async () => {
            const body = responses[callIndex];
            callIndex += 1;
            return new Response(JSON.stringify(body), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        });

        const agent = new TestableLexeyAgent();
        const events: AgentEvent[] = [];
        agent.setEventListener((event) => events.push(event));
        const answer = await agent.ask("测试输入");

        assert.equal(fetchMock.mock.callCount(), 2);
        assert.equal(answer, "done");
        assert.deepEqual(
            events.map((event) => event.type),
            ["start", "function_call", "function_result", "message", "complete"],
        );

        const input = agent.getInput();
        const outputItems = input.filter(isFunctionCallOutputItem);
        assert.equal(outputItems.length, 1);
        assert.ok(outputItems[0]?.output.includes(`# ${SKILL_NAME}`));

        const rows = selectMessageFromMessageTableStmt.all(dbAgentId);
        const lastRow = rows[rows.length - 1];
        assert.ok(lastRow !== undefined);
        const delta = JSON.parse(lastRow.content) as InputItemType[];
        assert.ok(delta.some((item) => isMessageItem(item) && item.content === "测试输入"));
        assert.ok(delta.some(isFunctionCallOutputItem));

        const conversation = agent.getConversationHistory();
        assert.ok(conversation.some((message) => message.role === "user" && message.text === "测试输入"));
        assert.ok(conversation.some((message) => message.role === "assistant" && message.text === "done"));
    });
});
