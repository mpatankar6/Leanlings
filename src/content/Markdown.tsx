// Markdown renderer for chapters, appendix, glossary and quizzes.
//
// Built on marked's lexer (no HTML strings), with two Leanlings additions:
// `[[id]]` / `[[id|text]]` glossary terms, and inline code that matches a
// glossary entry's `code_tokens` linking to that entry. ```lean blocks are
// syntax-highlighted with Monaco once the Lean language is loaded.

import { Fragment, ReactNode, useEffect, useState } from "react";
import { Marked, Token, Tokens, TokenizerExtension } from "marked";
import { colorize } from "../lean";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Term, useGlossary } from "./Glossary";

type GlossaryToken = { type: "glossary"; raw: string; id: string; text: string };

const glossaryExtension: TokenizerExtension = {
  name: "glossary",
  level: "inline",
  start: (src) => {
    const i = src.indexOf("[[");
    return i === -1 ? undefined : i;
  },
  tokenizer(src) {
    const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: "glossary", raw: m[0], id: m[1].trim(), text: (m[2] ?? m[1]).trim() };
  },
};

const marked = new Marked({ gfm: true, extensions: [glossaryExtension] });

export function Markdown({ text, className }: { text: string; className?: string }) {
  const tokens = marked.lexer(text);
  return <div className={`md ${className ?? ""}`}>{blocks(tokens)}</div>;
}

function blocks(tokens: Token[]): ReactNode[] {
  return tokens.map((t, i) => <Fragment key={i}>{block(t)}</Fragment>);
}

function block(t: Token): ReactNode {
  switch (t.type) {
    case "heading": {
      const h = t as Tokens.Heading;
      const Tag = `h${Math.min(h.depth + 1, 6)}` as "h2"; // h1 in content renders as h2
      return <Tag>{inline(h.tokens)}</Tag>;
    }
    case "paragraph":
      return <p>{inline((t as Tokens.Paragraph).tokens)}</p>;
    case "text": {
      const tt = t as Tokens.Text;
      return tt.tokens ? inline(tt.tokens) : tt.text;
    }
    case "list": {
      const l = t as Tokens.List;
      const items = l.items.map((item, i) => <li key={i}>{blocks(item.tokens)}</li>);
      return l.ordered ? <ol start={l.start || undefined}>{items}</ol> : <ul>{items}</ul>;
    }
    case "blockquote":
      return <blockquote>{blocks((t as Tokens.Blockquote).tokens)}</blockquote>;
    case "code": {
      const c = t as Tokens.Code;
      return <CodeBlock info={c.lang ?? ""} code={c.text} />;
    }
    case "table": {
      const tb = t as Tokens.Table;
      return (
        <table>
          <thead>
            <tr>
              {tb.header.map((cell, i) => (
                <th key={i}>{inline(cell.tokens)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i}>{inline(cell.tokens)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "hr":
      return <hr />;
    case "space":
      return null;
    default:
      return "text" in t ? <p>{String((t as { text: string }).text)}</p> : null;
  }
}

function inline(tokens: Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((t, i) => <InlineToken key={i} token={t} />);
}

function InlineToken({ token: t }: { token: Token }) {
  const glossary = useGlossary();
  switch (t.type) {
    case "text": {
      const tt = t as Tokens.Text;
      return <>{tt.tokens ? inline(tt.tokens) : tt.text}</>;
    }
    case "escape":
      return <>{(t as Tokens.Escape).text}</>;
    case "strong":
      return <strong>{inline((t as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em>{inline((t as Tokens.Em).tokens)}</em>;
    case "del":
      return <del>{inline((t as Tokens.Del).tokens)}</del>;
    case "br":
      return <br />;
    case "codespan": {
      const code = unescapeHtml((t as Tokens.Codespan).text);
      const id = glossary.byCodeToken(code);
      return id ? (
        <Term id={id}>
          <code>{code}</code>
        </Term>
      ) : (
        <code>{code}</code>
      );
    }
    case "link": {
      const l = t as Tokens.Link;
      return (
        <a
          href={l.href}
          title={l.title ?? undefined}
          onClick={(e) => {
            e.preventDefault();
            void openUrl(l.href);
          }}
        >
          {inline(l.tokens)}
        </a>
      );
    }
    case "glossary": {
      const g = t as unknown as GlossaryToken;
      const code = /^`(.+)`$/.exec(g.text);
      return <Term id={g.id}>{code ? <code>{code[1]}</code> : g.text}</Term>;
    }
    default:
      return <>{"text" in t ? String((t as { text: string }).text) : ""}</>;
  }
}

/** marked HTML-escapes code span text; we render it as text, so undo that. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function CodeBlock({ info, code }: { info: string; code: string }) {
  const [lang, ...attrs] = info.split(/\s+/);
  const isLean = lang === "lean";
  const fails = isLean && attrs.some((a) => a.startsWith("error="));
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!isLean) return;
    let cancelled = false;
    colorize(code)
      .then((h) => !cancelled && setHtml(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, isLean]);

  return (
    <div className={`code-block ${isLean ? "lean" : lang} ${fails ? "fails" : ""}`}>
      {fails && <div className="code-badge">✕ Lean rejects this</div>}
      {lang === "text" && <div className="code-badge neutral">Lean output</div>}
      {/* colorize() output is generated by Monaco from our own text, escaped. */}
      {html ? <pre dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{code}</pre>}
    </div>
  );
}
