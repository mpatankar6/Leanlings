// `\to` → `→` input, using the same rewriter as the VS Code Lean extension
// (@leanprover/unicode-input) with Monaco as its text source.

import * as monaco from "./monaco";
import {
  AbbreviationProvider,
  AbbreviationRewriter,
  AbbreviationTextSource,
  Change,
  Range,
} from "@leanprover/unicode-input";

const config = { abbreviationCharacter: "\\", customTranslations: {}, eagerReplacementEnabled: true };
let provider: AbbreviationProvider | null = null;

export function attachAbbreviations(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  provider ??= new AbbreviationProvider(config);
  const model = editor.getModel()!;
  const toRange = (r: Range) => {
    const start = model.getPositionAt(r.offset);
    const end = model.getPositionAt(r.offset + r.length);
    return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
  };
  const fromSelection = (s: monaco.Selection) => {
    const start = model.getOffsetAt(s.getStartPosition());
    return new Range(start, model.getOffsetAt(s.getEndPosition()) - start);
  };

  const source: AbbreviationTextSource = {
    async replaceAbbreviations(changes: Change[]) {
      editor.executeEdits(
        "abbreviation",
        changes.map((c) => ({ range: toRange(c.range), text: c.newText })),
      );
      return true;
    },
    selectionMoveMode: () => ({ kind: "MoveAllSelections" }),
    collectSelections: () => (editor.getSelections() ?? []).map(fromSelection),
    setSelections(selections) {
      editor.setSelections(
        selections.map((s) => {
          const r = toRange(s);
          return new monaco.Selection(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn);
        }),
      );
    },
  };
  const rewriter = new AbbreviationRewriter(config, provider, source);

  // Underline abbreviations still being typed, like VS Code does.
  const decorations = editor.createDecorationsCollection();
  const active = editor.createContextKey<boolean>("leanlings.abbreviationActive", false);
  const update = () => {
    const tracked = [...rewriter.getTrackedAbbreviations()];
    decorations.set(
      tracked.map((a) => ({
        range: toRange(a.range), // includes the leader character
        options: { inlineClassName: "lean-abbreviation" },
      })),
    );
    active.set(tracked.length > 0);
  };

  const subs = [
    // The rewriter also sees its own replacements here; it ignores them.
    editor.onDidChangeModelContent(async (e) => {
      rewriter.changeInput(e.changes.map((c) => ({ range: new Range(c.rangeOffset, c.rangeLength), newText: c.text })));
      // Let Monaco settle the cursor before replacing.
      await new Promise((r) => setTimeout(r, 0));
      await rewriter.triggerAbbreviationReplacement();
      update();
    }),
    editor.onDidChangeCursorSelection(async () => {
      await rewriter.changeSelections((editor.getSelections() ?? []).map(fromSelection));
      update();
    }),
  ];
  // Tab finishes an abbreviation that is still ambiguous (e.g. `\a`).
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => void rewriter.replaceAllTrackedAbbreviations().then(update),
    "leanlings.abbreviationActive",
  );

  return {
    dispose() {
      for (const s of subs) s.dispose();
      decorations.clear();
    },
  };
}
