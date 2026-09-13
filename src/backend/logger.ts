import pino from "pino";

export const logger = process.env.PANTHEON_TUI === "1"
    ? pino({level: "silent"})
    : pino({
        transport: {
            target: "pino-pretty",
            options: {colorize: true},
        },
    });
