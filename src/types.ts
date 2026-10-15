// Shapes of the data sent by the Rust backend (src-tauri/src/curriculum.rs).

export type Chapter = {
  id: string;
  number: number;
  title: string;
  summary: string;
  placeholder: boolean;
  doc?: string;
  quiz?: string;
  banned: string[];
};

export type AppendixArticle = { id: string; title: string; summary: string; doc: string };

export type Exercise = {
  id: string;
  chapter: string;
  title: string;
  placeholder: boolean;
  path?: string;
  theorem?: string;
  statement?: string;
  description?: string;
  hint?: string;
  banned?: string[];
};

export type GlossaryEntry = {
  title: string;
  kind: "concept" | "tactic" | "definition" | "command" | "notation";
  introducedIn: string;
  summary: string;
  explanation: string;
  seeAlso: string[];
  codeTokens: string[];
  docUrl: string;
};

export type Glossary = Record<string, GlossaryEntry>;

export type QuizOption = { text: string; correct: boolean; explanation: string };
export type Question = { id: string; kind: "single" | "multi"; prompt: string; options: QuizOption[] };
export type Quiz = { questions: Question[] };

export type Progress = {
  completed: string[];
  quizzes: Record<string, { best: number; total: number }>;
  read: string[];
};

export type Snapshot = {
  wsUrl: string;
  curriculum: { chapters: Chapter[]; appendix: AppendixArticle[]; exercises: Exercise[] };
  glossary: Glossary;
  progress: Progress;
};

export type CheckResult = { passed: boolean; summary: string; output: string };

/** What the main area shows. */
export type View =
  | { kind: "doc"; id: string }
  | { kind: "quiz"; chapter: string }
  | { kind: "exercise"; id: string }
  | { kind: "glossary"; focus?: string };
