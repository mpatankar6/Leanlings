mod curriculum;
mod exercises;
mod lsp_bridge;
mod toolchain;
#[cfg(test)]
mod verify;

use curriculum::{Curriculum, Exercise, GlossaryEntry, Quiz};
use exercises::{CheckResult, Progress, QuizScore};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct AppState {
    /// Bundled, read-only content (info, glossary, chapters, starters).
    pristine: PathBuf,
    /// The learner's editable copy of the exercise project.
    workspace: PathBuf,
    progress_path: PathBuf,
    curriculum: Curriculum,
    glossary: BTreeMap<String, GlossaryEntry>,
    ws_url: String,
    progress: Mutex<Progress>,
}

impl AppState {
    fn exercise(&self, id: &str) -> Result<&Exercise, String> {
        self.curriculum
            .exercise(id)
            .ok_or_else(|| format!("unknown exercise `{id}`"))
    }

    fn update_progress(&self, f: impl FnOnce(&mut Progress) -> bool) -> Result<(), String> {
        let mut progress = self.progress.lock().unwrap();
        if f(&mut progress) {
            progress.save(&self.progress_path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot<'a> {
    ws_url: &'a str,
    curriculum: &'a Curriculum,
    glossary: &'a BTreeMap<String, GlossaryEntry>,
    progress: &'a Progress,
}

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> Result<String, String> {
    let progress = state.progress.lock().unwrap();
    serde_json::to_string(&Snapshot {
        ws_url: &state.ws_url,
        curriculum: &state.curriculum,
        glossary: &state.glossary,
        progress: &progress,
    })
    .map_err(|e| e.to_string())
}

/// Markdown for a chapter or appendix article.
#[tauri::command]
fn read_doc(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let c = &state.curriculum;
    let rel = c
        .chapters
        .iter()
        .find(|ch| ch.id == id)
        .and_then(|ch| ch.doc.clone())
        .or_else(|| c.appendix.iter().find(|a| a.id == id).map(|a| a.doc.clone()))
        .ok_or_else(|| format!("no document for `{id}`"))?;
    let text = curriculum::read_doc(&state.pristine, &rel)?;
    state.update_progress(|p| p.read.insert(id))?;
    Ok(text)
}

#[tauri::command]
fn get_quiz(state: State<'_, AppState>, chapter: String) -> Result<Quiz, String> {
    let rel = state
        .curriculum
        .chapter(&chapter)
        .and_then(|c| c.quiz.clone())
        .ok_or_else(|| format!("no quiz for `{chapter}`"))?;
    curriculum::load_quiz(&state.pristine, &rel)
}

/// Record a quiz attempt; keeps the best score.
#[tauri::command]
fn record_quiz(state: State<'_, AppState>, chapter: String, score: u32, total: u32) -> Result<(), String> {
    state.update_progress(|p| {
        let entry = p.quizzes.entry(chapter).or_default();
        if score >= entry.best || entry.total != total {
            *entry = QuizScore { best: score, total };
            true
        } else {
            false
        }
    })
}

#[tauri::command]
fn read_exercise(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let ex = state.exercise(&id)?;
    fs::read_to_string(state.workspace.join(ex.path.as_deref().unwrap())).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_exercise(state: State<'_, AppState>, id: String, content: String) -> Result<(), String> {
    let ex = state.exercise(&id)?;
    fs::write(state.workspace.join(ex.path.as_deref().unwrap()), content).map_err(|e| e.to_string())
}

/// Restore the original exercise file and return its contents.
#[tauri::command]
fn reset_exercise(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let ex = state.exercise(&id)?;
    let rel = ex.path.as_deref().unwrap();
    let original = fs::read_to_string(state.pristine.join(rel)).map_err(|e| e.to_string())?;
    fs::write(state.workspace.join(rel), &original).map_err(|e| e.to_string())?;
    Ok(original)
}

#[tauri::command]
async fn check_exercise(state: State<'_, AppState>, id: String, content: String) -> Result<CheckResult, String> {
    let ex = state.exercise(&id)?;
    let banned = state.curriculum.banned_for(ex);
    let result = exercises::check(&state.workspace, ex, &content, banned).await?;
    if result.passed {
        state.update_progress(|p| p.completed.insert(id))?;
    }
    Ok(result)
}

#[tauri::command]
async fn toolchain_status(state: State<'_, AppState>) -> Result<toolchain::ToolchainStatus, String> {
    toolchain::status(&state.workspace).await
}

#[tauri::command]
async fn install_toolchain(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    toolchain::install(&state.workspace, &app).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let pristine = app.path().resource_dir()?.join("exercises");
            let data_dir = app.path().app_data_dir()?;
            let workspace = data_dir.join("workspace");
            exercises::sync_workspace(&pristine, &workspace)?;
            let curriculum = Curriculum::load(&pristine)?;
            let glossary = curriculum::load_glossary(&pristine)?;
            let progress_path = data_dir.join("progress.json");

            let token = uuid::Uuid::new_v4().simple().to_string();
            let listener = tauri::async_runtime::block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))?;
            let ws_url = format!("ws://127.0.0.1:{}/{token}", listener.local_addr()?.port());
            #[cfg(debug_assertions)]
            eprintln!("[leanlings] LSP bridge listening on {ws_url}");
            tauri::async_runtime::spawn(lsp_bridge::serve(
                listener,
                workspace.clone(),
                token,
                app.handle().clone(),
            ));

            app.manage(AppState {
                pristine,
                workspace,
                progress: Mutex::new(Progress::load(&progress_path)),
                progress_path,
                curriculum,
                glossary,
                ws_url,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            read_doc,
            get_quiz,
            record_quiz,
            read_exercise,
            save_exercise,
            reset_exercise,
            check_exercise,
            toolchain_status,
            install_toolchain
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
