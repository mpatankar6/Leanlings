//! The learner's workspace, progress, and solution checking.

use crate::curriculum::{self, Exercise};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Axioms a solution is allowed to depend on. Anything else (notably `sorryAx`,
/// or an axiom the learner declared themselves) fails the check.
const ALLOWED_AXIOMS: &[&str] = &["propext", "Classical.choice", "Quot.sound"];

/// Files that are always refreshed from the pristine copy, so app updates
/// reach existing workspaces. Exercise `.lean` files are only copied if missing.
const ALWAYS_REFRESH: &[&str] = &["lakefile.toml", "lean-toolchain", "info.toml", "glossary.toml"];

/// Content that is read straight from the pristine copy, never from the workspace.
const SKIP_DIRS: &[&str] = &[".lake", "Chapters", "Appendix"];

const CHECK_DIR: &str = ".leanlings_check";

/// Records the hash of each starter file as last copied into the workspace,
/// so an updated starter can replace a file the learner never edited.
const MANIFEST: &str = ".leanlings_manifest.json";

/// Copy the pristine exercise project into the workspace without clobbering
/// the learner's edits. A workspace file is replaced by a newer starter only if
/// it still matches the starter it was copied from.
pub fn sync_workspace(pristine: &Path, workspace: &Path) -> io::Result<()> {
    fs::create_dir_all(workspace)?;
    let manifest_path = workspace.join(MANIFEST);
    let mut manifest: BTreeMap<String, u64> = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    copy_tree(pristine, workspace, pristine, &mut manifest)?;
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?)
}

fn copy_tree(src: &Path, dst: &Path, root: &Path, manifest: &mut BTreeMap<String, u64>) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if src == root && SKIP_DIRS.iter().any(|d| name == *d) {
            continue;
        }
        let (from, to) = (entry.path(), dst.join(&name));
        if entry.file_type()?.is_dir() {
            copy_tree(&from, &to, root, manifest)?;
            continue;
        }
        let top_level = from.parent() == Some(root);
        if top_level && ALWAYS_REFRESH.iter().any(|f| name == *f) {
            fs::copy(&from, &to)?;
            continue;
        }
        let key = from.strip_prefix(root).unwrap_or(&from).to_string_lossy().replace('\\', "/");
        let new = fnv1a(&fs::read(&from)?);
        let untouched = match fs::read(&to) {
            Err(_) => true, // missing
            Ok(current) => {
                let current = fnv1a(&current);
                // Unchanged since we copied it, or already identical.
                manifest.get(&key) == Some(&current) || current == new
            }
        };
        if untouched {
            if manifest.get(&key) != Some(&new) || !to.exists() {
                fs::copy(&from, &to)?;
            }
            manifest.insert(key, new);
        }
    }
    Ok(())
}

/// FNV-1a: a stable, dependency-free content hash (not for security).
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3))
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Progress {
    /// Solved exercise ids.
    pub completed: BTreeSet<String>,
    /// Best quiz score per chapter id.
    #[serde(default)]
    pub quizzes: BTreeMap<String, QuizScore>,
    /// Chapter and appendix ids the learner has opened.
    #[serde(default)]
    pub read: BTreeSet<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
pub struct QuizScore {
    pub best: u32,
    pub total: u32,
}

impl Progress {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> io::Result<()> {
        fs::write(path, serde_json::to_string_pretty(self)?)
    }
}

#[derive(Debug, Serialize)]
pub struct CheckResult {
    pub passed: bool,
    /// Short human-readable reason, shown in the status bar.
    pub summary: String,
    /// Raw compiler output, for the details view.
    pub output: String,
}

/// Compile the learner's file with a hidden re-statement of the theorem and an
/// axiom audit appended, so weakening the statement or using `sorry` fails.
/// Tactics in `banned` are rejected before compiling.
pub async fn check(
    workspace: &Path,
    ex: &Exercise,
    content: &str,
    banned: &[String],
) -> Result<CheckResult, String> {
    if let Some(tactic) = curriculum::find_banned(content, banned) {
        return Ok(CheckResult {
            passed: false,
            summary: format!("`{tactic}` isn't allowed in this exercise."),
            output: format!(
                "This exercise is about doing it by hand, so these are switched off:\n  {}",
                banned.join(", ")
            ),
        });
    }

    let theorem = ex.theorem.as_deref().unwrap_or_default();
    let statement = ex.statement.as_deref().unwrap_or_default();

    let dir = workspace.join(CHECK_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file: PathBuf = dir.join(format!("{}.lean", ex.id));
    let source = format!(
        "{content}\n\n-- leanlings check\nexample : {statement} := {theorem}\n#print axioms {theorem}\n"
    );
    fs::write(&file, source).map_err(|e| e.to_string())?;

    let mut cmd = Command::new("lake");
    cmd.arg("env").arg("lean").arg(&file).current_dir(workspace);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("could not run `lake` (is elan installed and on PATH?): {e}"))?;

    let output = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .replace(&file.display().to_string(), &ex.path.clone().unwrap_or_default());

    let summary = if !out.status.success() || output.contains(": error") {
        "There are still errors.".to_string()
    } else {
        match axioms_used(&output, theorem) {
            None => "Could not verify the proof.".to_string(),
            Some(axioms) if axioms.iter().any(|a| a == "sorryAx") => {
                "The proof still uses `sorry`.".to_string()
            }
            Some(axioms) => match axioms.iter().find(|a| !ALLOWED_AXIOMS.contains(&a.as_str())) {
                Some(bad) => format!("The proof depends on a disallowed axiom: `{bad}`."),
                None => return Ok(CheckResult { passed: true, summary: "Solved!".into(), output }),
            },
        }
    };
    Ok(CheckResult { passed: false, summary, output })
}

/// Parse the output of `#print axioms`. `None` if the line is missing.
fn axioms_used(output: &str, theorem: &str) -> Option<Vec<String>> {
    let head = format!("'{theorem}'");
    let line = output.lines().find(|l| l.starts_with(&head))?;
    if line.contains("does not depend on any axioms") {
        return Some(Vec::new());
    }
    let list = line.split_once("depends on axioms: [")?.1.trim_end_matches(']');
    Some(list.split(',').map(|s| s.trim().to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_updates_only_unedited_files() {
        let base = std::env::temp_dir().join(format!("leanlings-sync-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (pristine, ws) = (base.join("pristine"), base.join("ws"));
        fs::create_dir_all(pristine.join("Exercises")).unwrap();
        fs::write(pristine.join("Exercises/a.lean"), "a v1").unwrap();
        fs::write(pristine.join("Exercises/b.lean"), "b v1").unwrap();

        sync_workspace(&pristine, &ws).unwrap();
        assert_eq!(fs::read_to_string(ws.join("Exercises/a.lean")).unwrap(), "a v1");

        // The learner edits `a`; both starters get updated.
        fs::write(ws.join("Exercises/a.lean"), "a edited").unwrap();
        fs::write(pristine.join("Exercises/a.lean"), "a v2").unwrap();
        fs::write(pristine.join("Exercises/b.lean"), "b v2").unwrap();
        sync_workspace(&pristine, &ws).unwrap();

        assert_eq!(fs::read_to_string(ws.join("Exercises/a.lean")).unwrap(), "a edited");
        assert_eq!(fs::read_to_string(ws.join("Exercises/b.lean")).unwrap(), "b v2");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn parses_axiom_lines() {
        assert_eq!(axioms_used("'t' does not depend on any axioms", "t"), Some(vec![]));
        assert_eq!(
            axioms_used("x\n't' depends on axioms: [propext, sorryAx]\n", "t"),
            Some(vec!["propext".into(), "sorryAx".into()])
        );
        assert_eq!(axioms_used("nothing here", "t"), None);
    }
}
