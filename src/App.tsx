import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LeanMonaco, LeanMonacoEditor } from "lean4monaco";
import { formatBytes, LoadingScreen, Prompt, Step, StepState } from "./Loading";
import { Markdown, setLeanLanguageReady } from "./content/Markdown";
import { GlossaryPage, GlossaryProvider, Term } from "./content/Glossary";
import { QuizView } from "./content/QuizView";
import type { Chapter, CheckResult, Exercise, Progress, Snapshot, View } from "./types";
import "./App.css";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; result: CheckResult }
  | { kind: "error"; message: string };

/** Emitted by the Rust LSP bridge (see `LeanStatus` in lsp_bridge.rs). */
type LeanStatus =
  | { stage: "spawning" | "initializing" | "initialized" }
  | { stage: "processing"; uri: string; progress: number }
  | { stage: "fileReady"; uri: string }
  | { stage: "error"; message: string };

/** From the `toolchain_status` command (see toolchain.rs). */
type ToolchainStatus = { toolchain: string; elanFound: boolean; installed: boolean };

type StepId = "app" | "exercises" | "toolchain" | "editor" | "server" | "file";
const STEP_ORDER: StepId[] = ["app", "exercises", "toolchain", "editor", "server", "file"];

function initialSteps(): Record<StepId, Step> {
  const boot = window.__bootStats;
  return {
    app: {
      label: "Loading app code",
      state: "done",
      detail: boot ? `${boot.files} files · ${formatBytes(boot.bytes)}` : undefined,
      startedAt: boot?.start ?? 0,
      endedAt: performance.now(),
    },
    exercises: { label: "Reading chapters and progress", state: "pending" },
    toolchain: { label: "Checking the Lean toolchain", state: "pending" },
    editor: { label: "Starting editor and infoview", state: "pending" },
    server: { label: "Starting Lean server", state: "pending" },
    file: { label: "Checking your current exercise", state: "pending" },
  };
}

const fileUri = (path: string) => `file:///${path}`;
const baseName = (path: string) => path.split("/").pop() ?? path;

/** How long to wait after the last keystroke before saving and checking. */
const CHECK_DELAY_MS = 800;

/** Where to start: the first chapter with work left. */
function startingPoint(s: Snapshot): { view: View; exercise: string | null } {
  const { chapters, exercises } = s.curriculum;
  const playable = exercises.filter((e) => !e.placeholder);
  const firstUnsolved = playable.find((e) => !s.progress.completed.includes(e.id)) ?? playable[0];
  const chapter = chapters.find((c) => c.id === firstUnsolved?.chapter) ?? chapters.find((c) => !c.placeholder);
  const exercise = firstUnsolved?.id ?? null;
  if (chapter && !s.progress.read.includes(chapter.id)) return { view: { kind: "doc", id: chapter.id }, exercise };
  if (exercise) return { view: { kind: "exercise", id: exercise }, exercise };
  return { view: { kind: "glossary" }, exercise };
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [progress, setProgress] = useState<Progress>({ completed: [], quizzes: {}, read: [] });
  const [view, setView] = useState<View>({ kind: "glossary" });
  const [steps, setSteps] = useState(initialSteps);
  // Per-file Lean progress (client URIs): 0–1 while processing, 1 when done.
  const [fileProgress, setFileProgress] = useState<Record<string, number>>({});
  const [editorOpenFor, setEditorOpenFor] = useState<string | null>(null);
  // The exercise loaded in the editor. It stays loaded while reading or
  // taking a quiz, so switching back is instant.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showHint, setShowHint] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [toolchainReady, setToolchainReady] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const editorEl = useRef<HTMLDivElement>(null);
  const infoviewEl = useRef<HTMLDivElement>(null);
  const leanReady = useRef<Promise<void> | null>(null);
  const editor = useRef<LeanMonacoEditor | null>(null);

  const chapters = snapshot?.curriculum.chapters ?? [];
  const playable = useMemo(() => snapshot?.curriculum.exercises.filter((e) => !e.placeholder) ?? [], [snapshot]);
  const current = playable.find((e) => e.id === currentId) ?? null;
  const completed = useMemo(() => new Set(progress.completed), [progress.completed]);

  const mark = useCallback((id: StepId, state: StepState, extra: Partial<Step> = {}) => {
    setSteps((s) => {
      const prev = s[id];
      const now = performance.now();
      const finished = state === "done" || state === "error";
      return {
        ...s,
        [id]: { ...prev, ...extra, state, startedAt: prev.startedAt ?? now, endedAt: finished ? (prev.endedAt ?? now) : undefined },
      };
    });
  }, []);

  // Lean server lifecycle events from the Rust bridge.
  useEffect(() => {
    const unlisten = listen<LeanStatus>("lean-status", ({ payload: p }) => {
      switch (p.stage) {
        case "spawning":
          return mark("server", "active", { detail: "Launching lake serve…" });
        case "initializing":
          return mark("server", "active", { detail: "Waiting for the Lean server to respond…" });
        case "initialized":
          return mark("server", "done", { detail: "Connected" });
        case "processing":
          return setFileProgress((m) => ({ ...m, [p.uri]: p.progress }));
        case "fileReady":
          return setFileProgress((m) => ({ ...m, [p.uri]: 1 }));
        case "error":
          return mark("server", "error", { detail: p.message });
      }
    });
    return () => void unlisten.then((f) => f());
  }, [mark]);

  // Load curriculum and progress, and decide where to start.
  useEffect(() => {
    mark("exercises", "active");
    invoke<string>("get_state")
      .then((json) => {
        const s = JSON.parse(json) as Snapshot;
        const real = s.curriculum.chapters.filter((c) => !c.placeholder);
        mark("exercises", "done", {
          detail: `${real.length} of ${s.curriculum.chapters.length} chapters · ${s.progress.completed.length} exercises solved`,
        });
        const start = startingPoint(s);
        setSnapshot(s);
        setProgress(s.progress);
        setCurrentId(start.exercise);
        setView(start.view);
      })
      .catch((e) => mark("exercises", "error", { detail: String(e) }));
  }, [mark]);

  // Make sure the pinned toolchain is installed before anything runs `lake`;
  // otherwise elan would silently download it on the first call.
  useEffect(() => {
    if (!snapshot) return;
    const version = (t: string) => t.replace(/^.*:v?/, "");
    const install = (t: string) => {
      setPrompt(null);
      mark("toolchain", "active", { detail: `Downloading and installing Lean ${version(t)}…` });
      const unlisten = listen<{ bytes: number }>("toolchain-progress", ({ payload }) => {
        if (payload.bytes > 0)
          mark("toolchain", "active", {
            detail: `Downloading and installing Lean ${version(t)}… ${formatBytes(payload.bytes)}`,
          });
      });
      invoke("install_toolchain")
        .then(() => {
          mark("toolchain", "done", { detail: `Installed Lean ${version(t)}` });
          setToolchainReady(true);
        })
        .catch((e) => mark("toolchain", "error", { detail: String(e) }))
        .finally(() => void unlisten.then((f) => f()));
    };
    mark("toolchain", "active");
    invoke<ToolchainStatus>("toolchain_status")
      .then((t) => {
        if (t.installed) {
          mark("toolchain", "done", { detail: `Lean ${version(t.toolchain)}` });
          setToolchainReady(true);
        } else if (!t.elanFound) {
          mark("toolchain", "error", {
            detail: "elan, the Lean version manager, isn't installed. Install it, then retry.",
          });
          setPrompt({
            message: "Leanlings needs elan to download and run Lean.",
            actions: [
              { label: "Retry", onClick: () => window.location.reload() },
              {
                label: "How to install elan",
                primary: true,
                onClick: () => void openUrl("https://github.com/leanprover/elan#installation"),
              },
            ],
          });
        } else {
          mark("toolchain", "active", { detail: `Lean ${version(t.toolchain)} isn't installed` });
          setPrompt({
            message: `Leanlings needs Lean ${version(t.toolchain)} (${t.toolchain}), which isn't installed yet. Download and install it now with elan? This is a large download.`,
            actions: [
              {
                label: "Not now",
                onClick: () => {
                  setPrompt(null);
                  mark("toolchain", "error", { detail: `Lean ${version(t.toolchain)} is needed to check your proofs.` });
                },
              },
              { label: "Install", primary: true, onClick: () => install(t.toolchain) },
            ],
          });
        }
      })
      .catch((e) => mark("toolchain", "error", { detail: String(e) }));
  }, [snapshot, mark]);

  // Start the single LeanMonaco instance (LSP client + infoview).
  useEffect(() => {
    if (!snapshot || !toolchainReady || !infoviewEl.current) return;
    const lean = new LeanMonaco();
    lean.setInfoviewElement(infoviewEl.current);
    mark("editor", "active", { detail: "Loading Monaco and the Lean extension…" });
    leanReady.current = lean.start({
      websocket: { url: snapshot.wsUrl },
      htmlElement: editorEl.current ?? undefined,
      vscode: { "editor.wordWrap": true },
    });
    setLeanLanguageReady(leanReady.current);
    leanReady.current.then(
      () => mark("editor", "done"),
      (e) => mark("editor", "error", { detail: String(e) }),
    );
    return () => lean.dispose();
  }, [snapshot, toolchainReady, mark]);

  // The last startup step: Lean has finished processing the first exercise.
  const startupFile = useRef<string | null>(null);
  useEffect(() => {
    if (!editorOpenFor) return;
    startupFile.current ??= editorOpenFor;
    const path = startupFile.current;
    const p = fileProgress[fileUri(path)];
    if (p === 1) mark("file", "done", { detail: baseName(path) });
    else mark("file", "active", { detail: `Lean is processing ${baseName(path)}…`, progress: p ?? 0 });
  }, [editorOpenFor, fileProgress, mark]);

  const stepList = STEP_ORDER.map((id) => steps[id]);
  const loaded = stepList.every((s) => s.state === "done");
  const [loaderGone, setLoaderGone] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => setLoaderGone(true), 400);
    return () => window.clearTimeout(t);
  }, [loaded]);

  const runCheck = useCallback(async (id: string, content: string) => {
    setStatus({ kind: "checking" });
    try {
      await invoke("save_exercise", { id, content });
      const result = await invoke<CheckResult>("check_exercise", { id, content });
      setStatus({ kind: "done", result });
      if (result.passed)
        setProgress((p) => (p.completed.includes(id) ? p : { ...p, completed: [...p.completed, id] }));
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  // (Re)open the editor whenever the current exercise changes.
  useEffect(() => {
    if (!current?.path || !editorEl.current || !leanReady.current) return;
    const el = editorEl.current;
    const id = current.id;
    let cancelled = false;
    let timer: number | undefined;
    const ed = new LeanMonacoEditor();
    setStatus({ kind: "idle" });
    setShowHint(false);
    setShowOutput(false);

    (async () => {
      const [content] = await Promise.all([invoke<string>("read_exercise", { id }), leanReady.current]);
      if (cancelled) return;
      await ed.start(el, `/${current.path}`, content);
      if (cancelled) return;
      editor.current = ed;
      setEditorOpenFor(current.path!);
      runCheck(id, content);
      ed.editor.onDidChangeModelContent(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => runCheck(id, ed.editor.getValue()), CHECK_DELAY_MS);
      });
    })().catch((e) => setStatus({ kind: "error", message: String(e) }));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      editor.current = null;
      ed.dispose();
    };
    // toolchainReady: leanReady is set once the toolchain is installed.
  }, [current, runCheck, toolchainReady]);

  const openExercise = useCallback((id: string) => {
    setCurrentId(id);
    setView({ kind: "exercise", id });
  }, []);
  const openEntry = useCallback((id: string) => setView({ kind: "glossary", focus: id }), []);

  const reset = async () => {
    if (!current || !editor.current) return;
    if (!window.confirm(`Reset "${current.title}" to its original state? Your changes will be lost.`)) return;
    const original = await invoke<string>("reset_exercise", { id: current.id });
    editor.current.editor.setValue(original);
  };

  const loader = !loaderGone && <LoadingScreen steps={stepList} hidden={loaded} prompt={prompt} />;
  if (!snapshot) return loader;

  const chapterOf = (ex: Exercise | null) => chapters.find((c) => c.id === ex?.chapter);
  const currentChapter = chapterOf(current);
  const next = playable[playable.findIndex((e) => e.id === currentId) + 1];
  const nextChapter = currentChapter && chapters.find((c) => c.number === currentChapter.number + 1);
  const currentProgress = current?.path ? fileProgress[fileUri(current.path)] : undefined;
  const isExercise = view.kind === "exercise";

  const goNext = () => {
    if (next && next.chapter === current?.chapter) openExercise(next.id);
    else if (nextChapter && !nextChapter.placeholder) setView({ kind: "doc", id: nextChapter.id });
    else if (next) openExercise(next.id);
  };
  const hasNext = Boolean(next) || Boolean(nextChapter && !nextChapter.placeholder);

  return (
    <GlossaryProvider entries={snapshot.glossary} chapters={chapters} openEntry={openEntry}>
      <div className="app">
        {loader}
        <Sidebar
          snapshot={snapshot}
          progress={progress}
          view={view}
          onView={setView}
          onExercise={openExercise}
        />

        {!isExercise && (
          <section className="reading-pane">
            {view.kind === "doc" && (
              <DocView
                id={view.id}
                snapshot={snapshot}
                onRead={(id) => setProgress((p) => (p.read.includes(id) ? p : { ...p, read: [...p.read, id] }))}
                onQuiz={(chapter) => setView({ kind: "quiz", chapter })}
                onExercises={(chapter) => {
                  const first = playable.find((e) => e.chapter === chapter && !completed.has(e.id)) ??
                    playable.find((e) => e.chapter === chapter);
                  if (first) openExercise(first.id);
                }}
              />
            )}
            {view.kind === "quiz" && chapters.find((c) => c.id === view.chapter) && (
              <QuizView
                chapter={chapters.find((c) => c.id === view.chapter)!}
                onRecorded={(score, total) =>
                  setProgress((p) => {
                    const prev = p.quizzes[view.chapter];
                    const keep = prev && prev.total === total && prev.best > score;
                    return keep ? p : { ...p, quizzes: { ...p.quizzes, [view.chapter]: { best: score, total } } };
                  })
                }
                onContinue={() => {
                  const first = playable.find((e) => e.chapter === view.chapter && !completed.has(e.id)) ??
                    playable.find((e) => e.chapter === view.chapter);
                  if (first) openExercise(first.id);
                }}
                onReread={() => setView({ kind: "doc", id: view.chapter })}
              />
            )}
            {view.kind === "glossary" && <GlossaryPage focus={view.focus} />}
          </section>
        )}

        {/* The editor and infoview stay mounted (hidden) so Lean keeps running. */}
        <main className="editor-pane" hidden={!isExercise}>
          <div className="toolbar">
            <strong className="toolbar-title" title={current?.title}>
              {currentChapter && <span className="muted">{currentChapter.number}. </span>}
              {current?.title}
            </strong>
            <span className="spacer" />
            {currentProgress !== undefined && currentProgress < 1 && (
              <span className="badge">Lean: processing {Math.round(currentProgress * 100)}%</span>
            )}
            <StatusBadge status={status} />
            <button onClick={() => current && editor.current && runCheck(current.id, editor.current.editor.getValue())}>
              Check
            </button>
            <button onClick={reset}>Reset</button>
            <button onClick={goNext} disabled={!hasNext}>
              Next →
            </button>
          </div>
          <div className="editor" ref={editorEl} />
        </main>

        <aside className="side-pane" hidden={!isExercise}>
          <div className="description">
            {current?.description && <Markdown text={current.description} />}
            {currentChapter && <Toolbox chapter={currentChapter} exercise={current} snapshot={snapshot} />}
            {current?.hint && (
              <div className="hint">
                <button className="link" onClick={() => setShowHint((h) => !h)}>
                  {showHint ? "Hide hint" : "Show hint"}
                </button>
                {showHint && <Markdown text={current.hint} />}
              </div>
            )}
            {status.kind === "done" && !status.result.passed && status.result.output.trim() && (
              <div className="hint">
                <button className="link" onClick={() => setShowOutput((o) => !o)}>
                  {showOutput ? "Hide checker output" : "Show checker output"}
                </button>
                {showOutput && <pre className="output">{status.result.output}</pre>}
              </div>
            )}
            {currentChapter && (
              <p className="back-link">
                <button className="link" onClick={() => setView({ kind: "doc", id: currentChapter.id })}>
                  ← Re-read Chapter {currentChapter.number}
                </button>
              </p>
            )}
          </div>
          <div className="infoview" ref={infoviewEl} />
        </aside>
      </div>
    </GlossaryProvider>
  );
}

/** Reading material is evergreen: it gets an icon, never a done/not-done mark. */
const READING_ICON = "¶";

function Sidebar(props: {
  snapshot: Snapshot;
  progress: Progress;
  view: View;
  onView: (v: View) => void;
  onExercise: (id: string) => void;
}) {
  const { snapshot, progress, view, onView, onExercise } = props;
  const { chapters, appendix, exercises } = snapshot.curriculum;
  const playable = exercises.filter((e) => !e.placeholder);
  const solved = playable.filter((e) => progress.completed.includes(e.id)).length;
  const is = (v: View) => JSON.stringify(v) === JSON.stringify(view);

  return (
    <nav className="sidebar">
      <header>
        <h1>Leanlings</h1>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${(100 * solved) / Math.max(playable.length, 1)}%` }} />
        </div>
        <small>
          {solved} / {playable.length} exercises solved
        </small>
      </header>

      {chapters.map((ch) => {
        const exs = playable.filter((e) => e.chapter === ch.id);
        const done = exs.filter((e) => progress.completed.includes(e.id)).length;
        const quiz = progress.quizzes[ch.id];
        if (ch.placeholder)
          return (
            <section key={ch.id} className="chapter placeholder" title="Coming soon">
              <h2>
                <span className="chapter-number">{ch.number}</span>
                {ch.title}
              </h2>
            </section>
          );
        return (
          <section key={ch.id} className="chapter">
            <h2>
              <span className="chapter-number">{ch.number}</span>
              {ch.title}
              <span className="chapter-count">
                {done}/{exs.length}
              </span>
            </h2>
            <ul>
              <li>
                <button className={is({ kind: "doc", id: ch.id }) ? "active" : ""} onClick={() => onView({ kind: "doc", id: ch.id })}>
                  <span className="mark evergreen">{READING_ICON}</span>
                  Read
                </button>
              </li>
              {ch.quiz && (
                <li>
                  <button
                    className={is({ kind: "quiz", chapter: ch.id }) ? "active" : ""}
                    onClick={() => onView({ kind: "quiz", chapter: ch.id })}
                  >
                    <span className="mark">{quiz ? (quiz.best === quiz.total ? "✓" : "◐") : "○"}</span>
                    Quiz
                    {quiz && (
                      <span className="item-meta">
                        {quiz.best}/{quiz.total}
                      </span>
                    )}
                  </button>
                </li>
              )}
              {exs.map((e) => (
                <li key={e.id}>
                  <button
                    className={view.kind === "exercise" && view.id === e.id ? "active" : ""}
                    onClick={() => onExercise(e.id)}
                  >
                    <span className="mark">{progress.completed.includes(e.id) ? "✓" : "○"}</span>
                    {e.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="chapter">
        <h2>Appendix</h2>
        <ul>
          {appendix.map((a) => (
            <li key={a.id}>
              <button className={is({ kind: "doc", id: a.id }) ? "active" : ""} onClick={() => onView({ kind: "doc", id: a.id })}>
                <span className="mark evergreen">{READING_ICON}</span>
                {a.title}
              </button>
            </li>
          ))}
          <li>
            <button className={view.kind === "glossary" ? "active" : ""} onClick={() => onView({ kind: "glossary" })}>
              <span className="mark evergreen">≡</span>
              Glossary
            </button>
          </li>
        </ul>
      </section>
    </nav>
  );
}

function DocView(props: {
  id: string;
  snapshot: Snapshot;
  onRead: (id: string) => void;
  onQuiz: (chapter: string) => void;
  onExercises: (chapter: string) => void;
}) {
  const { id, snapshot, onRead } = props;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chapter = snapshot.curriculum.chapters.find((c) => c.id === id);
  const article = snapshot.curriculum.appendix.find((a) => a.id === id);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    invoke<string>("read_doc", { id })
      .then((t) => {
        setText(t);
        onRead(id);
        scroller.current?.scrollTo({ top: 0 });
      })
      .catch((e) => setError(String(e)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="reading doc" ref={scroller}>
      <p className="eyebrow">{chapter ? `Chapter ${chapter.number}` : article ? "Appendix" : ""}</p>
      {error && <p className="bad">Couldn't load this page: {error}</p>}
      {text === null && !error && <p className="muted">Loading…</p>}
      {text !== null && <Markdown text={text} className="doc-body" />}
      {chapter && text !== null && (
        <div className="doc-next">
          {chapter.quiz && (
            <button className="primary" onClick={() => props.onQuiz(chapter.id)}>
              Take the quiz →
            </button>
          )}
          <button onClick={() => props.onExercises(chapter.id)}>Go to the exercises</button>
        </div>
      )}
    </div>
  );
}

/** Tactics learned so far (from the glossary) and the ones switched off here. */
function Toolbox({ chapter, exercise, snapshot }: { chapter: Chapter; exercise: Exercise | null; snapshot: Snapshot }) {
  const chapterNumber = (id: string) => snapshot.curriculum.chapters.find((c) => c.id === id)?.number ?? Infinity;
  const tactics = Object.entries(snapshot.glossary)
    .filter(([id, e]) => e.kind === "tactic" && id !== "sorry" && chapterNumber(e.introducedIn) <= chapter.number)
    .sort(([, a], [, b]) => chapterNumber(a.introducedIn) - chapterNumber(b.introducedIn));
  const banned = exercise?.banned ?? chapter.banned;
  if (tactics.length === 0) return null;
  return (
    <div className="toolbox">
      <span className="toolbox-label">Your tactics:</span>{" "}
      {tactics.map(([id, e], i) => (
        <span key={id}>
          {i > 0 && " "}
          <Term id={id}>
            <code>{e.title}</code>
          </Term>
        </span>
      ))}
      {banned.length > 0 && (
        <p className="toolbox-banned" title={banned.join(", ")}>
          Switched off here:{" "}
          {banned.slice(0, 4).map((b, i) => (
            <span key={b}>
              {i > 0 && ", "}
              <code>{b}</code>
            </span>
          ))}
          {banned.length > 4 && ` and ${banned.length - 4} more`}.
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "checking":
      return <span className="badge">Checking…</span>;
    case "error":
      return <span className="badge bad" title={status.message}>Error</span>;
    case "done":
      return (
        <span className={`badge ${status.result.passed ? "good" : "bad"}`} title={status.result.summary}>
          {status.result.summary}
        </span>
      );
  }
}

export default App;
