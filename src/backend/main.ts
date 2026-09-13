process.env.PANTHEON_TUI = "1";

await import("./database/initDatabase.ts");

const [
    {GexepAgent},
    {JezehAgent},
    {LexeyAgent},
    {ZebehAgent},
    {PantheonApp},
] = await Promise.all([
    import("./DeepSeek/Agents/Gexep/GexepAgent.ts"),
    import("./DeepSeek/Agents/Jezeh/JezehAgent.ts"),
    import("./DeepSeek/Agents/Lexey/LexeyAgent.ts"),
    import("./DeepSeek/Agents/Zebeh/ZebehAgent.ts"),
    import("../ui/PantheonApp.ts"),
]);

if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Pantheon UI 需要在交互式终端中运行。");
}

const app = new PantheonApp([
    {
        name: "Gexep",
        title: "入口与协调者",
        description: "理解你的目标，并在授权后发送邮件。",
        agent: new GexepAgent(),
    },
    {
        name: "Jezeh",
        title: "备忘录管家",
        description: "在隔离沙箱中记录、检索、整理和导出 Markdown 备忘录。",
        agent: new JezehAgent(),
    },
    {
        name: "Lexey",
        title: "语言伙伴",
        description: "处理多语言学习、文本理解与表达任务。",
        agent: new LexeyAgent(),
    },
    {
        name: "Zebeh",
        title: "行为验证者",
        description: "用于开发阶段的 Agent 行为验证与调试。",
        agent: new ZebehAgent(),
    },
]);

app.start();
