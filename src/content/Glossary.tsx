// Glossary terms: clickable popovers in prose, and the glossary page.
//
// Accessibility (WCAG 1.4.13): the trigger is a real button; the popover
// opens on hover or keyboard focus, toggles on click, stays open while
// hovered, and closes on Escape.

import { createContext, ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Chapter, Glossary, GlossaryEntry } from "../types";
import { Markdown } from "./Markdown";

type GlossaryContextValue = {
  entries: Glossary;
  byCodeToken: (code: string) => string | undefined;
  chapterLabel: (introducedIn: string) => string;
  openEntry: (id: string) => void;
};

const GlossaryContext = createContext<GlossaryContextValue>({
  entries: {},
  byCodeToken: () => undefined,
  chapterLabel: (s) => s,
  openEntry: () => {},
});

export const useGlossary = () => useContext(GlossaryContext);

export function GlossaryProvider(props: {
  entries: Glossary;
  chapters: Chapter[];
  openEntry: (id: string) => void;
  children: ReactNode;
}) {
  const { entries, chapters, openEntry } = props;
  const value = useMemo<GlossaryContextValue>(() => {
    const tokens = new Map<string, string>();
    for (const [id, e] of Object.entries(entries)) for (const t of e.codeTokens) tokens.set(t, id);
    return {
      entries,
      byCodeToken: (code) => tokens.get(code),
      chapterLabel: (introducedIn) => {
        if (introducedIn === "appendix") return "Appendix";
        const ch = chapters.find((c) => c.id === introducedIn);
        return ch ? `Chapter ${ch.number}` : introducedIn;
      },
      openEntry,
    };
  }, [entries, chapters, openEntry]);
  return <GlossaryContext.Provider value={value}>{props.children}</GlossaryContext.Provider>;
}

const OPEN_DELAY = 250;
const CLOSE_DELAY = 200;

/** A glossary term in running text. Unknown ids render as plain text. */
export function Term({ id, children }: { id: string; children: ReactNode }) {
  const { entries, chapterLabel, openEntry } = useGlossary();
  const entry = entries[id];
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const popRef = useRef<HTMLSpanElement>(null);
  const popId = `term-pop-${id}-${useRef(Math.random().toString(36).slice(2)).current}`;

  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Flip above the term when there's no room below.
  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) setAbove(true);
  }, [open]);
  useEffect(() => {
    if (!open) setAbove(false);
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <span
      className="term"
      onMouseEnter={() => schedule(true, OPEN_DELAY)}
      onMouseLeave={() => schedule(false, CLOSE_DELAY)}
    >
      <button
        type="button"
        className="term-trigger"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => {
          window.clearTimeout(timer.current);
          setOpen((o) => !o);
        }}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setOpen(true)}
        onBlur={() => schedule(false, CLOSE_DELAY)}
      >
        {children}
      </button>
      {open && (
        <span
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={entry.title}
          className={`term-pop ${above ? "above" : ""}`}
          onMouseEnter={() => window.clearTimeout(timer.current)}
        >
          <span className="term-pop-head">
            <strong>{entry.title}</strong>
            <span className="term-kind">{entry.kind}</span>
          </span>
          <Markdown text={entry.summary} className="term-pop-body" />
          <span className="term-pop-foot">
            <span className="term-chapter">First seen in {chapterLabel(entry.introducedIn)}</span>
            <button
              type="button"
              className="link"
              onClick={() => {
                setOpen(false);
                openEntry(id);
              }}
            >
              More in glossary →
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

/** All glossary terms, alphabetical, searchable. */
export function GlossaryPage({ focus }: { focus?: string }) {
  const { entries, chapterLabel } = useGlossary();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focus ? [focus] : []));
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!focus) return;
    setQuery("");
    setExpanded((s) => new Set(s).add(focus));
    // Wait a frame so the expanded entry has its full height.
    requestAnimationFrame(() => refs.current[focus]?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [focus]);

  const list = Object.entries(entries)
    .filter(([id, e]) => matches(query, id, e))
    .sort(([, a], [, b]) => sortKey(a.title).localeCompare(sortKey(b.title)));

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="reading glossary-page">
      <h1>Glossary</h1>
      <p className="muted">Every term from the chapters, with the chapter where it first appears.</p>
      <input
        className="search"
        type="search"
        placeholder="Search terms…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search glossary"
      />
      {list.length === 0 && <p className="muted">No terms match “{query}”.</p>}
      <ul className="glossary-list">
        {list.map(([id, e]) => {
          const isOpen = expanded.has(id);
          return (
            <li key={id} ref={(el) => void (refs.current[id] = el)} className={focus === id ? "focused" : ""}>
              <button type="button" className="glossary-row" aria-expanded={isOpen} onClick={() => toggle(id)}>
                <span className="glossary-title">{e.title}</span>
                <span className="term-kind">{e.kind}</span>
                <span className="term-chapter">{chapterLabel(e.introducedIn)}</span>
              </button>
              <Markdown text={e.summary} className="glossary-summary" />
              {isOpen && (
                <div className="glossary-detail">
                  {e.explanation && <Markdown text={e.explanation} />}
                  {e.seeAlso.length > 0 && (
                    <p className="see-also">
                      See also:{" "}
                      {e.seeAlso.map((s, i) => (
                        <span key={s}>
                          {i > 0 && ", "}
                          <Term id={s}>{entries[s]?.title ?? s}</Term>
                        </span>
                      ))}
                    </p>
                  )}
                  {e.docUrl && (
                    <p>
                      <a
                        href={e.docUrl}
                        onClick={(ev) => {
                          ev.preventDefault();
                          void openUrl(e.docUrl);
                        }}
                      >
                        Official documentation ↗
                      </a>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function matches(q: string, id: string, e: GlossaryEntry): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [id, e.title, e.summary, ...e.codeTokens].some((x) => x.toLowerCase().includes(s));
}

/** Sort `#check` with c, `⊢` after letters. */
function sortKey(title: string): string {
  return title.replace(/^[#]/, "").toLowerCase();
}
