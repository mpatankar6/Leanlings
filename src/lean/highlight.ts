// Lean syntax highlighting for Monaco: the official TextMate grammar from
// vscode-lean4 (see vendor/README.md), run by vscode-textmate, plus colour
// themes covering its scopes and Lean's semantic token types.

import * as monaco from "./monaco";
import { INITIAL, Registry, StateStack, parseRawGrammar } from "vscode-textmate";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";
import leanGrammar from "./vendor/lean4.json?raw";
import leanMarkdownGrammar from "./vendor/lean4-markdown.json?raw";
import languageConfiguration from "./vendor/language-configuration.json";

export const LANGUAGE_ID = "lean4";

class TokenizerState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new TokenizerState(this.stack.clone());
  }
  equals(other: monaco.languages.IState): boolean {
    return other instanceof TokenizerState && other.stack.equals(this.stack);
  }
}

async function register() {
  monaco.languages.register({ id: LANGUAGE_ID, extensions: [".lean"] });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, toMonacoConfig(languageConfiguration as Parameters<typeof toMonacoConfig>[0]));

  const wasm: ArrayBuffer = await (await fetch(onigWasmUrl)).arrayBuffer();
  await loadWASM(wasm);
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    // The grammars vscode-lean4 ships. Comments include the Markdown one;
    // other languages it embeds (fenced code in doc comments) are skipped.
    loadGrammar: async (scope) =>
      scope === "source.lean4"
        ? parseRawGrammar(leanGrammar, "lean4.json")
        : scope === "source.lean4.markdown"
          ? parseRawGrammar(leanMarkdownGrammar, "lean4-markdown.json")
          : null,
  });
  const grammar = await registry.loadGrammar("source.lean4");
  if (!grammar) throw new Error("Lean grammar failed to load");

  monaco.languages.setTokensProvider(LANGUAGE_ID, {
    getInitialState: () => new TokenizerState(INITIAL),
    tokenize(line, state: TokenizerState) {
      const r = grammar.tokenizeLine(line, state.stack);
      return {
        tokens: r.tokens.map((t) => ({ startIndex: t.startIndex, scopes: themedScope(t.scopes) })),
        endState: new TokenizerState(r.ruleStack),
      };
    },
  });

  defineThemes();
}

let registered: Promise<void> | null = null;

/** Register the Lean language once; resolves when highlighting works. */
export function registerLean(): Promise<void> {
  registered ??= register();
  return registered;
}

export function themeName(dark: boolean) {
  return dark ? "leanlings-dark" : "leanlings-light";
}

// VS Code's Light+/Dark+ colours for the scopes the grammars use. The bare
// names (`variable`, `leanSorryLike`) are Lean's semantic token types.
const LIGHT: monaco.editor.ITokenThemeRule[] = [
  { token: "comment", foreground: "008000" },
  { token: "string", foreground: "a31515" },
  { token: "constant.character.escape", foreground: "ee0000" },
  { token: "constant.numeric", foreground: "098658" },
  { token: "constant.language", foreground: "0000ff" },
  { token: "keyword", foreground: "0000ff" },
  { token: "storage", foreground: "0000ff" },
  { token: "entity.name.function", foreground: "795e26" },
  { token: "invalid", foreground: "cd3131" },
  { token: "markup.inline.raw", foreground: "800000" },
  { token: "markup.heading", foreground: "800000", fontStyle: "bold" },
  { token: "markup.bold", fontStyle: "bold" },
  { token: "markup.italic", fontStyle: "italic" },
  { token: "variable", foreground: "001080" },
  { token: "leanSorryLike", foreground: "cd3131", fontStyle: "bold" },
];
const DARK: monaco.editor.ITokenThemeRule[] = [
  { token: "comment", foreground: "6a9955" },
  { token: "string", foreground: "ce9178" },
  { token: "constant.character.escape", foreground: "d7ba7d" },
  { token: "constant.numeric", foreground: "b5cea8" },
  { token: "constant.language", foreground: "569cd6" },
  { token: "keyword", foreground: "569cd6" },
  { token: "storage", foreground: "569cd6" },
  { token: "entity.name.function", foreground: "dcdcaa" },
  { token: "invalid", foreground: "f44747" },
  { token: "markup.inline.raw", foreground: "ce9178" },
  { token: "markup.heading", foreground: "569cd6", fontStyle: "bold" },
  { token: "markup.bold", fontStyle: "bold" },
  { token: "markup.italic", fontStyle: "italic" },
  { token: "variable", foreground: "9cdcfe" },
  { token: "leanSorryLike", foreground: "f44747", fontStyle: "bold" },
];
const THEMED = LIGHT.map((r) => r.token);

/**
 * Monaco styles a token by one scope name (matching rules by dotted prefix),
 * whereas VS Code considers the whole scope stack. Use the innermost scope
 * some rule covers, so e.g. plain text inside a comment's Markdown still
 * gets the comment colour.
 */
function themedScope(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (THEMED.some((t) => s === t || s.startsWith(`${t}.`))) return s;
  }
  return "";
}

function defineThemes() {
  monaco.editor.defineTheme("leanlings-light", { base: "vs", inherit: true, rules: LIGHT, colors: {} });
  monaco.editor.defineTheme("leanlings-dark", { base: "vs-dark", inherit: true, rules: DARK, colors: {} });
}

/** Convert VS Code's language-configuration.json (string regexes, pair arrays) to Monaco's shape. */
function toMonacoConfig(c: {
  comments: { lineComment: string; blockComment: [string, string] };
  brackets: [string, string][];
  autoClosingPairs: [string, string][];
  surroundingPairs: [string, string][];
  wordPattern: string;
  onEnterRules: { beforeText: string; action: { indent: string } }[];
}): monaco.languages.LanguageConfiguration {
  const pair = ([open, close]: [string, string]) => ({ open, close });
  const indentAction: Record<string, monaco.languages.IndentAction> = {
    none: monaco.languages.IndentAction.None,
    indent: monaco.languages.IndentAction.Indent,
    indentOutdent: monaco.languages.IndentAction.IndentOutdent,
    outdent: monaco.languages.IndentAction.Outdent,
  };
  return {
    comments: c.comments,
    brackets: c.brackets,
    autoClosingPairs: c.autoClosingPairs.map(pair),
    surroundingPairs: c.surroundingPairs.map(pair),
    wordPattern: new RegExp(c.wordPattern),
    onEnterRules: c.onEnterRules.map((r) => ({
      beforeText: new RegExp(r.beforeText),
      action: { indentAction: indentAction[r.action.indent] },
    })),
  };
}
