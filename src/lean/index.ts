// Lean editing for Leanlings: Monaco + a Lean server connection + the
// infoview. Replaces lean4monaco with only the parts the app uses.

import * as monaco from "./monaco";
import { LANGUAGE_ID, registerLean, themeName } from "./highlight";
import { LeanSession } from "./session";
import { InfoviewHost } from "./infoview";
import { attachAbbreviations } from "./abbreviations";
import "./fonts.css";
import "./editor.css";

export { registerLean };

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => monaco.editor.setTheme(themeName(darkQuery.matches)));

/** Syntax-highlight Lean code as HTML (for Markdown code blocks). */
export async function colorize(code: string): Promise<string> {
  await registerLean();
  monaco.editor.setTheme(themeName(darkQuery.matches));
  return monaco.editor.colorize(code, LANGUAGE_ID, { tabSize: 2 });
}

export type LeanEditor = {
  editor: monaco.editor.IStandaloneCodeEditor;
  dispose(): void;
};

export class Lean {
  private constructor(
    private session: LeanSession,
    private infoview: InfoviewHost,
  ) {}

  /** Connect to the Lean server (via the Rust bridge) and show the infoview in `infoviewEl`. */
  static async start(wsUrl: string, infoviewEl: HTMLElement): Promise<Lean> {
    const [session] = await Promise.all([LeanSession.start(wsUrl), registerLean()]);
    return new Lean(session, new InfoviewHost(infoviewEl, session));
  }

  /** Open `path` (e.g. `Exercises/01_hello/rfl.lean`) with `content` in a new editor inside `el`. */
  openEditor(el: HTMLElement, path: string, content: string): LeanEditor {
    // The bridge maps `file:///<path>` to the learner's workspace.
    const uri = monaco.Uri.parse(`file:///${path.replace(/^\/+/, "")}`);
    monaco.editor.getModel(uri)?.dispose();
    const model = monaco.editor.createModel(content, LANGUAGE_ID, uri);
    const editor = monaco.editor.create(el, {
      model,
      theme: themeName(darkQuery.matches),
      automaticLayout: true,
      fontFamily: "'JuliaMono', Consolas, monospace",
      fontSize: 14,
      lineNumbers: "on",
      minimap: { enabled: false },
      folding: false,
      stickyScroll: { enabled: false },
      glyphMargin: false,
      lineDecorationsWidth: 8, // room for the progress bar
      wordWrap: "on",
      wrappingStrategy: "advanced",
      renderWhitespace: "trailing",
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      "semanticHighlighting.enabled": true,
      // Lean is full of Unicode that would otherwise be flagged as ambiguous.
      unicodeHighlight: { ambiguousCharacters: false },
      // From vscode-lean4's defaults for Lean files.
      wordSeparators: "`~@$%^&*()-=+[{]}⟨⟩⦃⦄⟦⟧⟮⟯‹›\\|;:\",.<>/",
      scrollBeyondLastLine: false,
    });
    const subs = [this.session.open(editor), attachAbbreviations(editor)];
    this.infoview.setEditor(editor);
    return {
      editor,
      dispose: () => {
        this.infoview.setEditor(null);
        for (const s of subs) s.dispose();
        editor.dispose();
        model.dispose();
      },
    };
  }

  dispose() {
    this.infoview.dispose();
    this.session.dispose();
  }
}
