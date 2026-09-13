import {
    type InputFunctionCallItem,
    type InputFunctionCallOutputItem,
    type InputItemType,
    type InputMessageItem,
    ModelType,
    type ResponseSchema,
    type ToolsType
} from "../API/responses.ts";
import {ModelClient} from "../ModelClient.ts";
import {logger} from "../../logger.ts";
import {
    insertIntoMessageTableStmt,
    selectMaxTurnFromAgentTableStmt,
    selectMessageFromMessageTableStmt, selectNameFromAgentTableStmt
} from "../../database/stmt.ts";

export type AgentEvent =
    | {type: "start"; agentName: string}
    | {type: "reasoning"; text: string}
    | {type: "message"; text: string}
    | {type: "function_call"; name: string}
    | {type: "function_result"; name: string; output: string}
    | {type: "web_search"}
    | {type: "complete"; agentName: string}
    | {type: "error"; error: Error};

export interface ConversationMessage {
    role: "user" | "assistant";
    text: string;
}

export type AgentEventListener = (event: AgentEvent) => void;



export abstract class BaseAgent{
    private readonly functionTools: ToolsType;
    private readonly instructions: string;
    private readonly model: ModelType;
    private modelClient: ModelClient;
    private eventListener: AgentEventListener | undefined;

    protected readonly agentId: number;
    protected readonly agentName: string;
    protected maxTurn: number;
    protected input: InputItemType[];

    protected constructor(
        model: ModelType,
        instructions: string,
        agentId: number,
        functionTools: ToolsType,
    ) {
        this.functionTools = functionTools;
        this.instructions = instructions;
        this.model = model;
        this.modelClient = new ModelClient();
        this.agentId = agentId;

        const max_turn = selectMaxTurnFromAgentTableStmt.get(agentId) as number;

        const messageRows = selectMessageFromMessageTableStmt.all(agentId);
        const input: InputItemType[] = [];
        for (const row of messageRows) {
            try {
                input.push(...(JSON.parse(row.content) as InputItemType[]));
            } catch {
                logger.warn(`跳过无法解析的 message 行: ${row.content}`);
            }
        }

        const agentName = selectNameFromAgentTableStmt.get(agentId) as string;

        this.maxTurn = max_turn;
        this.input = input;
        this.agentName = agentName;

        logger.info("new class BaseAgent()");
    }

    public setEventListener(listener: AgentEventListener | undefined): void {
        this.eventListener = listener;
    }

    public getConversationHistory(): ConversationMessage[] {
        const messages: ConversationMessage[] = [];

        for (const rawItem of this.input as unknown[]) {
            if (typeof rawItem !== "object" || rawItem === null) {
                continue;
            }

            const item = rawItem as Record<string, unknown>;
            if (item.type !== "message" || (item.role !== "user" && item.role !== "assistant")) {
                continue;
            }

            if (typeof item.content === "string") {
                messages.push({role: item.role, text: item.content});
                continue;
            }

            if (!Array.isArray(item.content)) {
                continue;
            }

            const text = item.content
                .map((contentItem: unknown) => {
                    if (typeof contentItem !== "object" || contentItem === null) {
                        return "";
                    }
                    const content = contentItem as Record<string, unknown>;
                    return typeof content.text === "string" ? content.text : "";
                })
                .filter(Boolean)
                .join("\n");

            if (text) {
                messages.push({role: item.role, text});
            }
        }

        return messages;
    }

    private emit(event: AgentEvent): void {
        this.eventListener?.(event);
    }

    private createInputMessageItemAndPush(userInput: string) {
        const inputMessageItem: InputMessageItem = {
            type: "message",
            role: "user",
            content: userInput,
        };
        logger.info(inputMessageItem.type);
        logger.info(inputMessageItem.content);
        this.input.push(inputMessageItem);
    }

    protected abstract requestFunctionCall(inputFunctionCallItem: InputFunctionCallItem): Promise<void>;

    protected createFunctionCallOutputItemAndPush(inputFunctionCallItem: InputFunctionCallItem, output: string){
        const functionCallOutputItem: InputFunctionCallOutputItem = {
            type: "function_call_output",
            call_id: inputFunctionCallItem.call_id,
            name: inputFunctionCallItem.name,
            arguments: inputFunctionCallItem.arguments,
            output: output,
        };

        this.input.push(functionCallOutputItem);
        this.emit({type: "function_result", name: inputFunctionCallItem.name, output});
    }

    public async ask(userInput: string): Promise<string> {
        logger.info("class BaseAgent public loop() start");

        const inputLengthBeforeLoop = this.input.length;
        const answerParts: string[] = [];

        this.createInputMessageItemAndPush(userInput);
        this.emit({type: "start", agentName: this.agentName});

        try {
            while(true){
                const response: ResponseSchema = await this.modelClient.requestResponsesAPI(
                    this.model,
                    this.input,
                    this.instructions,
                    this.functionTools,
                    this.agentName,
                );

                if (!Array.isArray(response.output)) {
                    throw new Error("模型响应中缺少 output 数组。");
                }

                let hasFunctionCall = false;
                for(const item of response.output){
                    this.input.push(item);
                    if(item.type == "message"){
                        logger.info(item.type);
                        for(const contentItem of item.content){
                            logger.info("\n" + contentItem.text);
                            answerParts.push(contentItem.text);
                            this.emit({type: "message", text: contentItem.text});
                        }
                    }else if(item.type == "reasoning"){
                        logger.info(item.type);
                        for(const contentItem of item.content){
                            logger.info("\n" + contentItem.text);
                            this.emit({type: "reasoning", text: contentItem.text});
                        }
                    }else if(item.type == "function_call"){
                        logger.info(item.type);
                        this.emit({type: "function_call", name: item.name});
                        await this.requestFunctionCall(item);
                        hasFunctionCall = true;
                    }else if(item.type == "web_search_call"){
                        logger.info(item.type);
                        this.emit({type: "web_search"});
                    }
                }
                if(!hasFunctionCall){
                    break;
                }
            }

            const inputDeltaAfterLoop = this.input.slice(inputLengthBeforeLoop);

            insertIntoMessageTableStmt.run(this.agentId, this.maxTurn, JSON.stringify(inputDeltaAfterLoop), 1);

            logger.info("class BaseAgent public loop() end");
            this.emit({type: "complete", agentName: this.agentName});
            return answerParts.join("\n\n");
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.emit({type: "error", error: normalizedError});
            throw normalizedError;
        }
    }
}
