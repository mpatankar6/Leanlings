// Monaco with only the editor features Leanlings uses. `import "monaco-editor"`
// would also pull in ~80 languages, completion, code actions, etc.

import "monaco-editor/features/bracketMatching/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/comment/register";
import "monaco-editor/features/contextmenu/register";
import "monaco-editor/features/cursorUndo/register";
import "monaco-editor/features/dnd/register";
import "monaco-editor/features/find/register";
import "monaco-editor/features/gotoError/register";
import "monaco-editor/features/hover/register";
import "monaco-editor/features/indentation/register";
import "monaco-editor/features/lineSelection/register";
import "monaco-editor/features/linesOperations/register";
import "monaco-editor/features/multicursor/register";
import "monaco-editor/features/smartSelect/register";
import "monaco-editor/features/unicodeHighlighter/register";
import "monaco-editor/features/wordOperations/register";
import "monaco-editor/features/wordPartOperations/register";
// Core pieces `monaco-editor`'s main entry also imports outside `features/`.
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens";
import "monaco-editor/editor/common/standaloneStrings";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export * from "monaco-editor/editor/editor.api";
