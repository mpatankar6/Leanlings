// Chapter quiz: single-answer and select-all questions, graded on the spot,
// with an explanation for every option.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Chapter, Question, Quiz } from "../types";
import { Markdown } from "./Markdown";

type Answer = { selected: Set<number>; submitted: boolean };

export function QuizView(props: {
  chapter: Chapter;
  onRecorded: (score: number, total: number) => void;
  onContinue: () => void;
  onReread: () => void;
}) {
  const { chapter, onRecorded } = props;
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setQuiz(null);
    invoke<Quiz>("get_quiz", { chapter: chapter.id })
      .then((q) => {
        setQuiz(q);
        setAnswers(q.questions.map(() => ({ selected: new Set(), submitted: false })));
      })
      .catch((e) => setError(String(e)));
  }, [chapter.id, attempt]);

  const done = quiz !== null && answers.length > 0 && answers.every((a) => a.submitted);
  const score = quiz ? quiz.questions.filter((q, i) => answers[i] && isCorrect(q, answers[i].selected)).length : 0;

  // Record once, when the last question is checked.
  useEffect(() => {
    if (!done || !quiz) return;
    const total = quiz.questions.length;
    invoke("record_quiz", { chapter: chapter.id, score, total })
      .then(() => onRecorded(score, total))
      .catch(console.error);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="reading">Couldn't load the quiz: {error}</div>;
  if (!quiz) return <div className="reading muted">Loading quiz…</div>;

  const update = (i: number, f: (a: Answer) => Answer) =>
    setAnswers((all) => all.map((a, j) => (j === i ? f(a) : a)));

  return (
    <div className="reading quiz">
      <p className="eyebrow">Chapter {chapter.number} · Quiz</p>
      <h1>{chapter.title}</h1>
      <p className="muted">
        Check your understanding before the exercises. This is optional, and your best score is saved.
      </p>

      {quiz.questions.map((q, i) => (
        <QuestionCard
          key={`${attempt}-${q.id}`}
          index={i}
          question={q}
          answer={answers[i]}
          onToggle={(opt) =>
            update(i, (a) => {
              if (a.submitted) return a;
              const selected = q.kind === "single" ? new Set([opt]) : new Set(a.selected);
              if (q.kind === "multi") {
                if (selected.has(opt)) selected.delete(opt);
                else selected.add(opt);
              }
              return { ...a, selected };
            })
          }
          onSubmit={() => update(i, (a) => ({ ...a, submitted: true }))}
        />
      ))}

      {done && (
        <div className="quiz-summary">
          <h2>
            {score} / {quiz.questions.length} correct
          </h2>
          <p>
            {score === quiz.questions.length
              ? "All correct. You're ready for the exercises."
              : "Read the explanations for the ones you missed. You can retry the quiz any time."}
          </p>
          <div className="actions">
            <button className="primary" onClick={props.onContinue}>
              Go to the exercises →
            </button>
            <button onClick={() => setAttempt((n) => n + 1)}>Retry quiz</button>
            <button onClick={props.onReread}>Re-read the chapter</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionCard(props: {
  index: number;
  question: Question;
  answer: Answer | undefined;
  onToggle: (option: number) => void;
  onSubmit: () => void;
}) {
  const { question: q, answer, index } = props;
  if (!answer) return null;
  const submitted = answer.submitted;
  const correct = submitted && isCorrect(q, answer.selected);
  const inputType = q.kind === "single" ? "radio" : "checkbox";

  return (
    <section className={`question ${submitted ? (correct ? "right" : "wrong") : ""}`}>
      <div className="question-head">
        <span className="question-number">Question {index + 1}</span>
        {q.kind === "multi" && <span className="question-kind">Select all that apply</span>}
      </div>
      <Markdown text={q.prompt} />
      <ul className="options" role={q.kind === "single" ? "radiogroup" : "group"}>
        {q.options.map((opt, i) => {
          const chosen = answer.selected.has(i);
          const state = !submitted ? "" : opt.correct ? "is-correct" : chosen ? "is-wrong" : "";
          return (
            <li key={i} className={`option ${chosen ? "chosen" : ""} ${state}`}>
              <label>
                <input
                  type={inputType}
                  name={`q-${q.id}`}
                  checked={chosen}
                  disabled={submitted}
                  onChange={() => props.onToggle(i)}
                />
                <span className="option-mark" aria-hidden>
                  {submitted ? (opt.correct ? "✓" : chosen ? "✕" : "") : ""}
                </span>
                <Markdown text={opt.text} className="option-text" />
              </label>
              {submitted && <Markdown text={opt.explanation} className="option-explanation" />}
            </li>
          );
        })}
      </ul>
      {!submitted ? (
        <button className="primary" disabled={answer.selected.size === 0} onClick={props.onSubmit}>
          Check answer
        </button>
      ) : (
        <p className={`verdict ${correct ? "good" : "bad"}`}>{correct ? "Correct!" : "Not quite. See the explanations above."}</p>
      )}
    </section>
  );
}

function isCorrect(q: Question, selected: Set<number>): boolean {
  return q.options.every((o, i) => o.correct === selected.has(i));
}
