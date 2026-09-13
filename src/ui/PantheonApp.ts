import {
    CombinedAutocompleteProvider,
    Editor,
    type Component,
    Key,
    Markdown,
    ProcessTerminal,
    ScrollView,
    TuiAltScreen,
    VStack,
    matchesKey,
    truncateToWidth,
    visibleWidth,
} from "@earendil-works/pi-tui";
import type {
    AgentEvent,
    AgentEventListener,
    ConversationMessage,
} from "../backend/DeepSeek/Agents/BaseAgent.ts";
import {colors, editorTheme, markdownTheme} from "./theme.ts";

export interface ChatAgent {
    ask(input: string): Promise<string>;
    getConversationHistory(): ConversationMessage[];
    setEventListener(listener: AgentEventListener | undefined): void;
}

export interface AgentDefinition {
    name: string;
    title: string;
    description: string;
    agent: ChatAgent;
}

type UiMessageRole = "user" | "assistant" | "notice" | "error";

interface UiMessage {
    role: UiMessageRole;
    text: string;
    agentName?: string;
}

function padToWidth(text: string, width: number): string {
    const clipped = truncateToWidth(text, Math.max(0, width), "");
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class Header implements Component {
    invalidate(): void {}

    render(width: number): string[] {
        if (width < 2) {
            return [""];
        }

        const title = colors.bold(colors.brightCyan(" PANTHEON OF CONFIDANTS "));
        const subtitle = colors.muted(" 多智能体运行时 · 每一位 Agent，都是一位挚友 ");
        const divider = colors.dim("─".repeat(width));

        return [padToWidth(title, width), padToWidth(subtitle, width), divider];
    }
}

class AgentTabs implements Component {
    constructor(
        private readonly definitions: AgentDefinition[],
        private readonly getActiveIndex: () => number,
    ) {}

    invalidate(): void {}

    render(width: number): string[] {
        const tabs = this.definitions.map((definition, index) => {
            const label = `${index + 1} ${definition.name}`;
            return index === this.getActiveIndex()
                ? colors.bold(colors.cyan(`● ${label}`))
                : colors.muted(`○ ${label}`);
        }).join(colors.dim("  │  "));

        return [truncateToWidth(` ${tabs}`, width, "")];
    }
}

class ConversationView implements Component {
    private messages: UiMessage[] = [];

    setMessages(messages: UiMessage[]): void {
        this.messages = [...messages];
    }

    invalidate(): void {}

    render(width: number): string[] {
        if (width <= 0) {
            return [];
        }

        const lines: string[] = [];
        for (const message of this.messages) {
            if (lines.length > 0) {
                lines.push("");
            }

            const label = this.renderLabel(message);
            lines.push(truncateToWidth(` ${label}`, width, ""));

            const defaultColor = message.role === "error"
                ? colors.red
                : message.role === "notice"
                    ? colors.muted
                    : colors.white;
            const markdown = new Markdown(
                message.text,
                Math.min(2, Math.max(0, Math.floor((width - 1) / 2))),
                0,
                markdownTheme,
                {color: defaultColor},
            );
            lines.push(...markdown.render(width));
        }

        return lines.length > 0 ? lines : [colors.muted("  暂无消息")];
    }

    private renderLabel(message: UiMessage): string {
        if (message.role === "user") {
            return colors.bold(colors.blue("YOU"));
        }
        if (message.role === "assistant") {
            return colors.bold(colors.violet(message.agentName ?? "AGENT"));
        }
        if (message.role === "error") {
            return colors.bold(colors.red("ERROR"));
        }
        return colors.bold(colors.muted("PANTHEON"));
    }
}

class ActivityLine implements Component {
    private readonly frames = ["✦", "✧", "◆", "◇"];
    private frame = 0;
    private timer: ReturnType<typeof setInterval> | undefined;
    private active = false;
    private text = "就绪";

    constructor(private readonly requestRender: () => void) {}

    set(text: string, active = false): void {
        this.text = text;
        this.active = active;

        if (active && this.timer === undefined) {
            this.timer = setInterval(() => {
                this.frame = (this.frame + 1) % this.frames.length;
                this.requestRender();
            }, 140);
        } else if (!active) {
            this.stopTimer();
        }
        this.requestRender();
    }

    dispose(): void {
        this.stopTimer();
    }

    invalidate(): void {}

    render(width: number): string[] {
        const icon = this.active ? colors.cyan(this.frames[this.frame] ?? "✦") : colors.green("●");
        const shortcuts = colors.dim("  Enter 发送 · Shift+Enter 换行 · /help 帮助");
        return [truncateToWidth(` ${icon} ${this.text}${shortcuts}`, width, "")];
    }

    private stopTimer(): void {
        if (this.timer !== undefined) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}

export class PantheonApp {
    private readonly tui = new TuiAltScreen(
        new ProcessTerminal(),
        true,
        undefined,
        {
            mouse: true,
            scrollToEndIndicator: () => colors.cyan(" ↓ 回到最新消息 "),
            searchMatchStyle: (text) => colors.underline(colors.amber(text)),
            searchCurrentMatchStyle: (text) => colors.bold(colors.amber(text)),
        },
    );
    private readonly editor = new Editor(this.tui, editorTheme, {paddingX: 1});
    private readonly conversationView = new ConversationView();
    private readonly activityLine = new ActivityLine(() => this.tui.requestRender());
    private readonly messagesByAgent = new Map<string, UiMessage[]>();
    private activeIndex = 0;
    private busy = false;
    private stopped = false;

    constructor(private readonly definitions: AgentDefinition[]) {
        if (definitions.length === 0) {
            throw new Error("PantheonApp 至少需要一个 Agent。");
        }

        for (const definition of definitions) {
            const messages = definition.agent.getConversationHistory().map((message): UiMessage => (
                message.role === "assistant"
                    ? {role: "assistant", text: message.text, agentName: definition.name}
                    : {role: "user", text: message.text}
            ));
            this.messagesByAgent.set(definition.name, messages);
        }

        const transcript = new ScrollView(this.conversationView, {
            follow: "end",
            primary: true,
            scrollbar: "auto",
            scrollbarTrackStyle: colors.dim,
            scrollbarThumbStyle: colors.cyan,
        });
        const root = new VStack([
            {component: new Header(), basis: 3, shrink: 0},
            {
                component: new AgentTabs(this.definitions, () => this.activeIndex),
                basis: 1,
                shrink: 0,
            },
            {component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1},
            {component: this.activityLine, basis: 1, shrink: 0},
            {component: this.editor, basis: "auto", shrink: 0, maxSize: 10},
        ]);

        this.tui.setLayoutRoot(root);
        this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider([
            {name: "help", description: "显示命令与快捷键"},
            {name: "agent", description: "切换 Agent，例如 /agent Lexey"},
            {name: "clear", description: "清空当前 Agent 的界面消息"},
            {name: "quit", description: "退出 Pantheon"},
        ], process.cwd()));
        this.editor.onSubmit = (text) => {
            void this.submit(text);
        };

        this.tui.addInputListener((data) => {
            if (matchesKey(data, Key.ctrl("c"))) {
                this.stop();
                return {consume: true};
            }
            if (matchesKey(data, Key.ctrl("l")) && !this.busy) {
                this.clearCurrentConversation();
                return {consume: true};
            }
            return undefined;
        });

        this.showActiveConversation();
    }

    start(): void {
        this.tui.setFocus(this.editor);
        this.tui.start();
    }

    stop(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        this.activityLine.dispose();
        for (const definition of this.definitions) {
            definition.agent.setEventListener(undefined);
        }
        this.tui.stop();
    }

    private get activeDefinition(): AgentDefinition {
        const definition = this.definitions[this.activeIndex];
        if (definition === undefined) {
            throw new Error("当前 Agent 不存在。");
        }
        return definition;
    }

    private get activeMessages(): UiMessage[] {
        const messages = this.messagesByAgent.get(this.activeDefinition.name);
        if (messages === undefined) {
            throw new Error(`找不到 ${this.activeDefinition.name} 的会话。`);
        }
        return messages;
    }

    private async submit(rawText: string): Promise<void> {
        const text = rawText.trim();
        if (!text || this.busy) {
            return;
        }

        this.editor.addToHistory(text);
        if (text.startsWith("/")) {
            this.handleCommand(text);
            return;
        }

        const definition = this.activeDefinition;
        const messages = this.activeMessages;
        messages.push({role: "user", text});
        this.conversationView.setMessages(messages);
        this.setBusy(true);

        definition.agent.setEventListener((event) => this.handleAgentEvent(definition, event));
        try {
            await definition.agent.ask(text);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!messages.some((item) => item.role === "error" && item.text === message)) {
                messages.push({role: "error", text: message});
            }
        } finally {
            definition.agent.setEventListener(undefined);
            this.setBusy(false);
            this.conversationView.setMessages(messages);
            this.tui.requestRender();
        }
    }

    private handleAgentEvent(definition: AgentDefinition, event: AgentEvent): void {
        const messages = this.messagesByAgent.get(definition.name);
        if (messages === undefined) {
            return;
        }

        switch (event.type) {
            case "start":
                this.activityLine.set(`${definition.name} 正在思考…`, true);
                break;
            case "reasoning":
                this.activityLine.set(`${definition.name} 正在梳理思路…`, true);
                break;
            case "function_call":
                this.activityLine.set(`${definition.name} 正在${this.describeTool(event.name)}…`, true);
                break;
            case "function_result":
                this.activityLine.set(`${this.describeTool(event.name)}完成，正在继续…`, true);
                break;
            case "web_search":
                this.activityLine.set(`${definition.name} 正在搜索网页…`, true);
                break;
            case "message":
                messages.push({role: "assistant", text: event.text, agentName: definition.name});
                this.conversationView.setMessages(messages);
                this.activityLine.set(`${definition.name} 正在完成回复…`, true);
                break;
            case "complete":
                this.activityLine.set(`${definition.name} 已就绪`);
                break;
            case "error":
                messages.push({role: "error", text: event.error.message});
                this.conversationView.setMessages(messages);
                this.activityLine.set("请求失败");
                break;
        }
        this.tui.requestRender();
    }

    private handleCommand(commandLine: string): void {
        const [command = "", ...args] = commandLine.slice(1).trim().split(/\s+/);

        switch (command.toLowerCase()) {
            case "help":
                this.activeMessages.push({
                    role: "notice",
                    text: [
                        "**可用命令**",
                        "",
                        "- `/agent <name>`：切换对话角色",
                        "- `/clear`：清空当前界面中的消息（不会删除数据库历史）",
                        "- `/quit`：退出界面",
                        "- `Ctrl+L`：快速清屏",
                        "- `Ctrl+C`：退出界面",
                        "",
                        "可用角色：" + this.definitions.map((item) => `**${item.name}**`).join("、"),
                    ].join("\n"),
                });
                this.showActiveConversation();
                break;
            case "agent":
                this.switchAgent(args.join(" "));
                break;
            case "clear":
                this.clearCurrentConversation();
                break;
            case "quit":
            case "exit":
                this.stop();
                break;
            default:
                this.activeMessages.push({
                    role: "error",
                    text: `未知命令：/${command}。输入 \`/help\` 查看可用命令。`,
                });
                this.showActiveConversation();
        }
    }

    private switchAgent(name: string): void {
        const normalizedName = name.trim().toLowerCase();
        const nextIndex = this.definitions.findIndex(
            (definition) => definition.name.toLowerCase() === normalizedName,
        );

        if (nextIndex < 0) {
            this.activeMessages.push({
                role: "error",
                text: name
                    ? `找不到 Agent “${name}”。可用角色：${this.definitions.map((item) => item.name).join("、")}。`
                    : `请指定 Agent，例如 \`/agent Lexey\`。`,
            });
            this.showActiveConversation();
            return;
        }

        this.activeIndex = nextIndex;
        this.showActiveConversation();
        this.activityLine.set(`${this.activeDefinition.name} 已就绪`);
    }

    private clearCurrentConversation(): void {
        this.messagesByAgent.set(this.activeDefinition.name, []);
        this.showActiveConversation();
    }

    private showActiveConversation(): void {
        const messages = this.activeMessages;
        if (messages.length === 0) {
            messages.push({
                role: "notice",
                text: `你正在与 **${this.activeDefinition.name}** 对话。${this.activeDefinition.title}：${this.activeDefinition.description}`,
            });
        }
        this.conversationView.setMessages(messages);
        this.tui.requestRender();
    }

    private setBusy(busy: boolean): void {
        this.busy = busy;
        this.editor.disableSubmit = busy;
        if (!busy) {
            this.activityLine.set(`${this.activeDefinition.name} 已就绪`);
        }
        this.tui.requestRender();
    }

    private describeTool(name: string): string {
        const labels: Record<string, string> = {
            send_email: "发送邮件",
            load_skill: "加载语言技能",
            e2b_shell_execute: "整理云端备忘录",
            download_memo: "下载备忘录",
        };
        return labels[name] ?? `调用 ${name}`;
    }
}
