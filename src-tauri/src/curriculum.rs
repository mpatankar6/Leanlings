//! Curriculum content: chapters, appendix articles, exercises, glossary and
//! quizzes. Formats are documented in docs/curriculum/CURRICULUM.md.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Chapter {
    pub id: String,
    pub number: u32,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub placeholder: bool,
    pub doc: Option<String>,
    pub quiz: Option<String>,
    /// Default banned tactics for this chapter's exercises.
    #[serde(default)]
    pub banned: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AppendixArticle {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub doc: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Exercise {
    pub id: String,
    pub chapter: String,
    pub title: String,
    #[serde(default)]
    pub placeholder: bool,
    pub path: Option<String>,
    pub theorem: Option<String>,
    pub statement: Option<String>,
    pub description: Option<String>,
    pub hint: Option<String>,
    /// Overrides the chapter's `banned` list when present.
    pub banned: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Curriculum {
    pub chapters: Vec<Chapter>,
    pub appendix: Vec<AppendixArticle>,
    pub exercises: Vec<Exercise>,
}

#[derive(Deserialize)]
struct InfoFile {
    #[serde(default)]
    chapter: Vec<Chapter>,
    #[serde(default)]
    appendix: Vec<AppendixArticle>,
    #[serde(default)]
    exercise: Vec<Exercise>,
}

impl Curriculum {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join("info.toml");
        let text = fs::read_to_string(&path).map_err(|e| format!("reading {}: {e}", path.display()))?;
        let info: InfoFile = toml::from_str(&text).map_err(|e| format!("parsing info.toml: {e}"))?;
        let curriculum = Self { chapters: info.chapter, appendix: info.appendix, exercises: info.exercise };
        for ex in &curriculum.exercises {
            if curriculum.chapter(&ex.chapter).is_none() {
                return Err(format!("exercise `{}` refers to unknown chapter `{}`", ex.id, ex.chapter));
            }
            if !ex.placeholder && (ex.path.is_none() || ex.theorem.is_none() || ex.statement.is_none()) {
                return Err(format!("exercise `{}` needs path, theorem and statement", ex.id));
            }
        }
        Ok(curriculum)
    }

    pub fn chapter(&self, id: &str) -> Option<&Chapter> {
        self.chapters.iter().find(|c| c.id == id)
    }

    pub fn exercise(&self, id: &str) -> Option<&Exercise> {
        self.exercises.iter().find(|e| e.id == id && !e.placeholder)
    }

    pub fn banned_for<'a>(&'a self, ex: &'a Exercise) -> &'a [String] {
        match &ex.banned {
            Some(list) => list,
            None => self.chapter(&ex.chapter).map(|c| c.banned.as_slice()).unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct GlossaryEntry {
    pub title: String,
    pub kind: String,
    pub introduced_in: String,
    pub summary: String,
    #[serde(default)]
    pub explanation: String,
    #[serde(default)]
    pub see_also: Vec<String>,
    #[serde(default)]
    pub code_tokens: Vec<String>,
    #[serde(default)]
    pub doc_url: String,
}

#[derive(Deserialize)]
struct GlossaryFile {
    #[serde(default)]
    term: BTreeMap<String, GlossaryEntry>,
}

pub fn load_glossary(root: &Path) -> Result<BTreeMap<String, GlossaryEntry>, String> {
    let path = root.join("glossary.toml");
    let text = fs::read_to_string(&path).map_err(|e| format!("reading {}: {e}", path.display()))?;
    let file: GlossaryFile = toml::from_str(&text).map_err(|e| format!("parsing glossary.toml: {e}"))?;
    Ok(file.term)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Quiz {
    #[serde(rename(deserialize = "question"))]
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Question {
    pub id: String,
    pub kind: QuestionKind,
    pub prompt: String,
    #[serde(rename(deserialize = "option"))]
    pub options: Vec<QuizOption>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QuestionKind {
    Single,
    Multi,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QuizOption {
    pub text: String,
    #[serde(default)]
    pub correct: bool,
    pub explanation: String,
}

pub fn load_quiz(root: &Path, rel: &str) -> Result<Quiz, String> {
    let text = read_doc(root, rel)?;
    toml::from_str(&text).map_err(|e| format!("parsing {rel}: {e}"))
}

/// Read a content file by its path relative to the content root.
pub fn read_doc(root: &Path, rel: &str) -> Result<String, String> {
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("invalid content path `{rel}`"));
    }
    fs::read_to_string(root.join(rel_path)).map_err(|e| format!("reading {rel}: {e}"))
}

/// The first banned tactic used in `source`, ignoring comments and strings.
pub fn find_banned(source: &str, banned: &[String]) -> Option<String> {
    if banned.is_empty() {
        return None;
    }
    strip_comments_and_strings(source)
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | '?' | '!' | '\'' | '.')))
        .find(|tok| banned.iter().any(|b| b == tok))
        .map(str::to_string)
}

/// Replace Lean comments (`--`, nested `/- -/`) and string literals with spaces.
fn strip_comments_and_strings(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while i < chars.len() {
        let next = chars.get(i + 1).copied();
        match (chars[i], next) {
            ('-', Some('-')) => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            ('/', Some('-')) => {
                let mut depth = 0;
                while i < chars.len() {
                    if chars[i] == '/' && chars.get(i + 1) == Some(&'-') {
                        depth += 1;
                        i += 2;
                    } else if chars[i] == '-' && chars.get(i + 1) == Some(&'/') {
                        depth -= 1;
                        i += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
                out.push(' ');
            }
            ('"', _) => {
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    i += if chars[i] == '\\' { 2 } else { 1 };
                }
                i += 1;
                out.push(' ');
            }
            (c, _) => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn banned(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_banned_tactics_outside_comments() {
        let b = banned(&["decide", "simp", "exact?"]);
        assert_eq!(find_banned("theorem t : 2 + 2 = 4 := by\n  decide\n", &b), Some("decide".into()));
        assert_eq!(find_banned("by exact?", &b), Some("exact?".into()));
        assert_eq!(find_banned("-- try decide\nby rfl", &b), None);
        assert_eq!(find_banned("/- simp /- nested -/ decide -/ by rfl", &b), None);
        assert_eq!(find_banned("#eval \"simp\"\nby rfl", &b), None);
        // Identifiers that merely contain a banned word are fine.
        assert_eq!(find_banned("exact Nat.decide_eq_true h", &b), None);
        assert_eq!(find_banned("simp_all", &b), None);
    }

    #[test]
    fn rejects_paths_outside_root() {
        let root = Path::new(".");
        assert!(read_doc(root, "../secret").is_err());
        assert!(read_doc(root, "/etc/passwd").is_err());
    }
}
