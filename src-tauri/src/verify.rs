//! Curriculum verifier. Run with `npm run verify:curriculum`
//! (`cargo test verify -- --include-ignored`). The ignored tests call Lean.
//!
//! See docs/curriculum/CURRICULUM.md for the rules being enforced.

use crate::curriculum::{self, Curriculum, GlossaryEntry, QuestionKind, Quiz};
use crate::exercises;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;

const KINDS: &[&str] = &["concept", "tactic", "definition", "command", "notation"];

fn content_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../exercises")
}

fn solutions_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../curriculum/solutions")
}

/// A piece of Markdown and where it came from, for error messages.
struct Doc {
    origin: String,
    /// Chapter id, "appendix", or "" for text that doesn't count as a mention
    /// (glossary entries themselves).
    owner: String,
    text: String,
}

struct Loaded {
    curriculum: Curriculum,
    glossary: BTreeMap<String, GlossaryEntry>,
    quizzes: Vec<(String, Quiz)>,
    docs: Vec<Doc>,
}

fn load(errors: &mut Vec<String>) -> Option<Loaded> {
    let root = content_root();
    let curriculum = Curriculum::load(&root).map_err(|e| errors.push(e)).ok()?;
    let glossary = curriculum::load_glossary(&root).map_err(|e| errors.push(e)).ok()?;
    let mut docs = Vec::new();
    let mut quizzes = Vec::new();

    for ch in curriculum.chapters.iter().filter(|c| !c.placeholder) {
        match ch.doc.as_deref().map(|d| (d, curriculum::read_doc(&root, d))) {
            Some((d, Ok(text))) => docs.push(Doc {
                origin: d.into(),
                owner: ch.id.clone(),
                text,
            }),
            Some((d, Err(e))) => errors.push(format!("{}: {e} ({d})", ch.id)),
            None => errors.push(format!("chapter `{}` has no doc", ch.id)),
        }
        match ch.quiz.as_deref().map(|q| (q, curriculum::load_quiz(&root, q))) {
            Some((q, Ok(quiz))) => {
                for question in &quiz.questions {
                    let origin = format!("{q}#{}", question.id);
                    docs.push(Doc {
                        origin: origin.clone(),
                        owner: ch.id.clone(),
                        text: question.prompt.clone(),
                    });
                    for opt in &question.options {
                        docs.push(Doc {
                            origin: origin.clone(),
                            owner: ch.id.clone(),
                            text: opt.text.clone(),
                        });
                        docs.push(Doc {
                            origin: origin.clone(),
                            owner: ch.id.clone(),
                            text: opt.explanation.clone(),
                        });
                    }
                }
                quizzes.push((ch.id.clone(), quiz));
            }
            Some((q, Err(e))) => errors.push(format!("{}: {e} ({q})", ch.id)),
            None => errors.push(format!("chapter `{}` has no quiz", ch.id)),
        }
    }
    for art in &curriculum.appendix {
        match curriculum::read_doc(&root, &art.doc) {
            Ok(text) => docs.push(Doc {
                origin: art.doc.clone(),
                owner: "appendix".into(),
                text,
            }),
            Err(e) => errors.push(format!("appendix `{}`: {e}", art.id)),
        }
    }
    for ex in curriculum.exercises.iter().filter(|e| !e.placeholder) {
        for text in [&ex.description, &ex.hint].into_iter().flatten() {
            docs.push(Doc {
                origin: format!("info.toml#{}", ex.id),
                owner: ex.chapter.clone(),
                text: text.clone(),
            });
        }
    }
    for (id, entry) in &glossary {
        for text in [&entry.summary, &entry.explanation] {
            docs.push(Doc {
                origin: format!("glossary.toml#{id}"),
                owner: String::new(),
                text: text.clone(),
            });
        }
    }
    Some(Loaded {
        curriculum,
        glossary,
        quizzes,
        docs,
    })
}

/// Strip blockquote markers (`> `), so fences inside quotes are found too.
fn unquote(line: &str) -> &str {
    let mut l = line.trim_start();
    if !l.starts_with('>') {
        return line; // keep indentation: it matters inside Lean code
    }
    while let Some(rest) = l.strip_prefix('>') {
        l = rest.strip_prefix(' ').unwrap_or(rest);
    }
    l
}

/// Fenced code blocks: (info string, code, 1-based start line).
fn code_blocks(md: &str) -> Vec<(String, String, usize)> {
    let mut blocks = Vec::new();
    let mut open: Option<(usize, String, usize, Vec<&str>)> = None; // (fence len, info, line, lines)
    for (n, raw) in md.lines().enumerate() {
        let line = unquote(raw);
        let trimmed = line.trim_start();
        let ticks = trimmed.chars().take_while(|&c| c == '`').count();
        match &mut open {
            None if ticks >= 3 => open = Some((ticks, trimmed[ticks..].trim().to_string(), n + 1, Vec::new())),
            Some((len, _, _, _)) if ticks >= *len && trimmed[ticks..].trim().is_empty() => {
                let (_, info, start, lines) = open.take().unwrap();
                blocks.push((info, lines.join("\n"), start));
            }
            Some((_, _, _, lines)) => lines.push(line),
            None => {}
        }
    }
    blocks
}

/// Text outside fenced code blocks and inline code spans.
fn prose_only(md: &str) -> String {
    let mut out = String::new();
    let mut fence: Option<usize> = None;
    for raw in md.lines() {
        let line = unquote(raw);
        let trimmed = line.trim_start();
        let ticks = trimmed.chars().take_while(|&c| c == '`').count();
        match fence {
            None if ticks >= 3 => fence = Some(ticks),
            Some(len) if ticks >= len && trimmed[ticks..].trim().is_empty() => fence = None,
            Some(_) => {}
            None => {
                // Drop inline code spans.
                let mut in_code = false;
                for c in line.chars() {
                    if c == '`' {
                        in_code = !in_code;
                    } else if !in_code {
                        out.push(c);
                    }
                }
                out.push('\n');
            }
        }
    }
    out
}

/// Inline code span contents (outside fences).
fn inline_code(md: &str) -> Vec<String> {
    let mut spans = Vec::new();
    let mut fence: Option<usize> = None;
    for raw in md.lines() {
        let line = unquote(raw);
        let trimmed = line.trim_start();
        let ticks = trimmed.chars().take_while(|&c| c == '`').count();
        match fence {
            None if ticks >= 3 => fence = Some(ticks),
            Some(len) if ticks >= len && trimmed[ticks..].trim().is_empty() => fence = None,
            Some(_) => {}
            None => {
                let parts: Vec<&str> = line.split('`').collect();
                spans.extend(parts.iter().skip(1).step_by(2).map(|s| s.to_string()));
            }
        }
    }
    spans
}

/// Ids referenced as `[[id]]` or `[[id|text]]`.
fn glossary_refs(md: &str) -> Vec<String> {
    let prose = prose_only(md);
    let mut refs = Vec::new();
    let mut rest = prose.as_str();
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let inner = &after[..end];
        refs.push(inner.split('|').next().unwrap_or("").trim().to_string());
        rest = &after[end + 2..];
    }
    refs
}

#[test]
fn content_is_consistent() {
    let mut errors = Vec::new();
    let Some(l) = load(&mut errors) else {
        panic!("{}", errors.join("\n"))
    };
    let c = &l.curriculum;

    // Unique ids.
    let mut seen = HashSet::new();
    let ids = c
        .chapters
        .iter()
        .map(|x| &x.id)
        .chain(c.appendix.iter().map(|x| &x.id))
        .chain(c.exercises.iter().map(|x| &x.id));
    for id in ids {
        if !seen.insert(id.clone()) {
            errors.push(format!("duplicate id `{id}`"));
        }
    }

    // Quizzes.
    for (chapter, quiz) in &l.quizzes {
        let mut qids = HashSet::new();
        if quiz.questions.is_empty() {
            errors.push(format!("{chapter}: quiz has no questions"));
        }
        for q in &quiz.questions {
            if !qids.insert(&q.id) {
                errors.push(format!("{chapter}: duplicate question id `{}`", q.id));
            }
            let correct = q.options.iter().filter(|o| o.correct).count();
            if q.options.len() < 2 {
                errors.push(format!("{chapter}/{}: needs at least 2 options", q.id));
            }
            match q.kind {
                QuestionKind::Single if correct != 1 => errors.push(format!(
                    "{chapter}/{}: single-answer question has {correct} correct options",
                    q.id
                )),
                QuestionKind::Multi if correct == 0 => errors.push(format!("{chapter}/{}: no correct options", q.id)),
                _ => {}
            }
            for o in &q.options {
                if o.explanation.trim().is_empty() {
                    errors.push(format!("{chapter}/{}: option without explanation: {}", q.id, o.text));
                }
            }
        }
    }

    // Glossary entries.
    let chapter_ids: HashSet<&str> = c.chapters.iter().map(|x| x.id.as_str()).collect();
    for (id, e) in &l.glossary {
        if !KINDS.contains(&e.kind.as_str()) {
            errors.push(format!("glossary `{id}`: unknown kind `{}`", e.kind));
        }
        if e.introduced_in != "appendix" && !chapter_ids.contains(e.introduced_in.as_str()) {
            errors.push(format!(
                "glossary `{id}`: introduced_in `{}` is not a chapter",
                e.introduced_in
            ));
        }
        for s in &e.see_also {
            if !l.glossary.contains_key(s) {
                errors.push(format!("glossary `{id}`: see_also `{s}` does not exist"));
            }
        }
        if e.summary.trim().is_empty() {
            errors.push(format!("glossary `{id}`: empty summary"));
        }
    }

    // Every [[ref]] resolves.
    for doc in &l.docs {
        for r in glossary_refs(&doc.text) {
            if !l.glossary.contains_key(&r) {
                errors.push(format!("{}: unknown glossary term [[{r}]]", doc.origin));
            }
        }
    }

    // `introduced_in` is the first place the term is mentioned
    // ([[ref]] or an inline-code token), in curriculum order.
    let mut order: Vec<&str> = c
        .chapters
        .iter()
        .filter(|x| !x.placeholder)
        .map(|x| x.id.as_str())
        .collect();
    order.push("appendix");
    for (id, e) in &l.glossary {
        let mentioned_in = |owner: &str| {
            l.docs.iter().filter(|d| d.owner == owner).any(|d| {
                glossary_refs(&d.text).iter().any(|r| r == id)
                    || inline_code(&d.text)
                        .iter()
                        .any(|s| e.code_tokens.iter().any(|t| t == s))
            })
        };
        match order.iter().find(|o| mentioned_in(o)) {
            Some(first) if *first != e.introduced_in => errors.push(format!(
                "glossary `{id}`: introduced_in is `{}` but first mentioned in `{first}`",
                e.introduced_in
            )),
            None => errors.push(format!("glossary `{id}`: never mentioned in any chapter or appendix")),
            _ => {}
        }
    }

    // Exercise files and reference solutions.
    for ex in c.exercises.iter().filter(|e| !e.placeholder) {
        let path = content_root().join(ex.path.as_deref().unwrap());
        if !path.exists() {
            errors.push(format!("exercise `{}`: missing {}", ex.id, path.display()));
        }
        if !solutions_root().join(format!("{}.lean", ex.id)).exists() {
            errors.push(format!(
                "exercise `{}`: missing curriculum/solutions/{}.lean",
                ex.id, ex.id
            ));
        }
        if c.chapter(&ex.chapter).is_some_and(|ch| ch.placeholder) {
            errors.push(format!(
                "exercise `{}` belongs to placeholder chapter `{}`",
                ex.id, ex.chapter
            ));
        }
    }

    assert!(errors.is_empty(), "\n{}\n", errors.join("\n"));
}

/// Compile `code` with plain `lean`; returns (succeeded, output).
fn run_lean(code: &str, name: &str) -> (bool, String) {
    let dir = std::env::temp_dir().join("leanlings-verify");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join(format!("{name}.lean"));
    std::fs::write(&file, code).unwrap();
    let out = Command::new("lean")
        .arg(&file)
        .current_dir(content_root())
        .output()
        .expect("could not run `lean`");
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out.status.success() && !text.contains(": error"), text)
}

#[test]
#[ignore = "calls Lean; run with --include-ignored"]
fn lean_snippets_behave_as_annotated() {
    let mut errors = Vec::new();
    let Some(l) = load(&mut errors) else {
        panic!("{}", errors.join("\n"))
    };
    let mut count = 0;
    for doc in &l.docs {
        for (info, code, line) in code_blocks(&doc.text) {
            let mut words = info.splitn(2, char::is_whitespace);
            if words.next() != Some("lean") {
                continue;
            }
            let attrs = words.next().unwrap_or("").trim();
            if attrs == "nocheck" {
                continue;
            }
            count += 1;
            let quoted = |key: &str| attrs.strip_prefix(key).map(|s| s.trim_matches('"').to_string());
            let expect_error = quoted("error=");
            let expect_output = quoted("output=");
            let (ok, output) = run_lean(&code, &format!("snippet{count}"));
            let at = format!("{}:{line}", doc.origin);
            match (&expect_error, ok) {
                (None, false) => errors.push(format!("{at}: expected to compile, but:\n{output}")),
                (Some(_), true) => errors.push(format!("{at}: expected an error, but it compiled")),
                (Some(text), false) if !output.contains(text.as_str()) => {
                    errors.push(format!("{at}: error output doesn't contain {text:?}:\n{output}"))
                }
                _ => {}
            }
            if let Some(text) = expect_output.filter(|t| !output.contains(t.as_str())) {
                errors.push(format!("{at}: output doesn't contain {text:?}:\n{output}"));
            }
        }
    }
    eprintln!("checked {count} lean snippets");
    assert!(errors.is_empty(), "\n{}\n", errors.join("\n\n"));
}

#[test]
#[ignore = "calls Lean; run with --include-ignored"]
fn starters_fail_and_solutions_pass() {
    let mut errors = Vec::new();
    let Some(l) = load(&mut errors) else {
        panic!("{}", errors.join("\n"))
    };
    let workspace = std::env::temp_dir().join("leanlings-verify-workspace");
    let _ = std::fs::remove_dir_all(&workspace);
    exercises::sync_workspace(&content_root(), &workspace).unwrap();
    let rt = tokio::runtime::Runtime::new().unwrap();

    for ex in l.curriculum.exercises.iter().filter(|e| !e.placeholder) {
        let banned = l.curriculum.banned_for(ex);
        let starter = std::fs::read_to_string(content_root().join(ex.path.as_deref().unwrap())).unwrap();
        let solution = std::fs::read_to_string(solutions_root().join(format!("{}.lean", ex.id))).unwrap_or_default();

        let r = rt.block_on(exercises::check(&workspace, ex, &starter, banned)).unwrap();
        if r.passed {
            errors.push(format!("{}: the starter already passes", ex.id));
        }
        let r = rt
            .block_on(exercises::check(&workspace, ex, &solution, banned))
            .unwrap();
        if !r.passed {
            errors.push(format!(
                "{}: reference solution fails: {}\n{}",
                ex.id, r.summary, r.output
            ));
        }
    }
    assert!(errors.is_empty(), "\n{}\n", errors.join("\n\n"));
}

#[test]
fn markdown_helpers() {
    let md = "Intro [[goal]] and [[hypothesis|hypotheses]] `[[not]]`\n```lean error=\"Type mismatch\"\nexample : 1 = 1 := rfl -- [[nope]]\n```\nuse `rfl` here";
    assert_eq!(glossary_refs(md), vec!["goal", "hypothesis"]);
    let blocks = code_blocks(md);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].0, "lean error=\"Type mismatch\"");
    assert_eq!(blocks[0].2, 2);
    assert_eq!(inline_code(md), vec!["[[not]]", "rfl"]);
}
