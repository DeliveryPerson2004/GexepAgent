import type {
    EditorTheme,
    MarkdownTheme,
    SelectListTheme,
} from "@earendil-works/pi-tui";

function ansi(open: string, close: string): (text: string) => string {
    return (text: string) => `\u001b[${open}m${text}\u001b[${close}m`;
}

export const colors = {
    cyan: ansi("38;5;80", "39"),
    brightCyan: ansi("38;5;123", "39"),
    violet: ansi("38;5;141", "39"),
    green: ansi("38;5;114", "39"),
    amber: ansi("38;5;221", "39"),
    red: ansi("38;5;203", "39"),
    blue: ansi("38;5;75", "39"),
    white: ansi("38;5;255", "39"),
    muted: ansi("38;5;244", "39"),
    dim: ansi("38;5;238", "39"),
    bold: ansi("1", "22"),
    italic: ansi("3", "23"),
    underline: ansi("4", "24"),
    strike: ansi("9", "29"),
};

export const selectListTheme: SelectListTheme = {
    selectedPrefix: colors.brightCyan,
    selectedText: (text) => colors.bold(colors.white(text)),
    description: colors.muted,
    scrollInfo: colors.dim,
    noMatch: colors.amber,
};

export const editorTheme: EditorTheme = {
    borderColor: colors.cyan,
    selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
    heading: (text) => colors.bold(colors.brightCyan(text)),
    link: colors.blue,
    linkUrl: colors.muted,
    code: colors.amber,
    codeBlock: colors.white,
    codeBlockBorder: colors.dim,
    quote: colors.muted,
    quoteBorder: colors.violet,
    hr: colors.dim,
    listBullet: colors.cyan,
    bold: colors.bold,
    italic: colors.italic,
    strikethrough: colors.strike,
    underline: colors.underline,
};
