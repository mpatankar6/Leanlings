//! Bridges the frontend's WebSocket LSP client (lean4monaco) to `lake serve`.
//!
//! Each WebSocket text frame carries one JSON-RPC message; on the Lean side we
//! speak standard LSP stdio framing (`Content-Length` headers). Each
//! connection gets its own `lake serve` process.
//!
//! The editor uses virtual paths like `file:///Exercises/01_intro/rfl.lean`,
//! which are rewritten to real paths inside the workspace and back.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;

type BoxError = Box<dyn Error + Send + Sync>;

const CLIENT_PREFIX: &str = "file:///";
const URI_KEYS: &[&str] = &["uri", "rootUri", "targetUri"];

/// Lean server lifecycle, emitted to the frontend as `lean-status` events so
/// the loading screen can show what is actually happening.
#[derive(Clone, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum LeanStatus {
    /// `lake serve` is being launched.
    Spawning,
    /// The client sent `initialize`; waiting for the server's reply.
    Initializing,
    /// The server answered `initialize`.
    Initialized,
    /// Lean is elaborating a file; `progress` is 0.0–1.0.
    Processing {
        uri: String,
        progress: f64,
    },
    /// Lean finished elaborating a file.
    FileReady {
        uri: String,
    },
    Error {
        message: String,
    },
}

/// Accept connections forever. Only requests to `/<token>` are accepted, so
/// other local processes and web pages can't drive the Lean server.
pub async fn serve(listener: TcpListener, workspace: PathBuf, token: String, app: AppHandle) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let (workspace, token, app) = (workspace.clone(), token.clone(), app.clone());
        tokio::spawn(async move {
            if let Err(e) = handle(stream, &workspace, &token, &app).await {
                eprintln!("[lsp-bridge] connection ended: {e}");
            }
        });
    }
}

// The handshake callback's `Err` type (an HTTP response) is fixed by tungstenite.
#[allow(clippy::result_large_err)]
async fn handle(stream: TcpStream, workspace: &Path, token: &str, app: &AppHandle) -> Result<(), BoxError> {
    let emit = |status: LeanStatus| {
        let _ = app.emit("lean-status", status);
    };
    let expected = format!("/{token}");
    let ws = tokio_tungstenite::accept_hdr_async(stream, |req: &Request, resp: Response| {
        if req.uri().path() == expected {
            Ok(resp)
        } else {
            let mut err = ErrorResponse::new(None);
            *err.status_mut() = StatusCode::FORBIDDEN;
            Err(err)
        }
    })
    .await?;

    let mut cmd = crate::toolchain::command("lake");
    cmd.args(["serve", "--"])
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    emit(LeanStatus::Spawning);
    let mut child = cmd.spawn().map_err(|e| {
        let message = format!("Could not start `lake serve` (is elan installed and on PATH?): {e}");
        emit(LeanStatus::Error {
            message: message.clone(),
        });
        message
    })?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("piped stdout"));

    let mapper = UriMapper::new(workspace);
    let (mut ws_tx, mut ws_rx) = ws.split();
    // Line count per (client) URI, to turn Lean's file progress into a fraction.
    let line_counts: Mutex<HashMap<String, usize>> = Mutex::default();

    let to_server = async {
        while let Some(msg) = ws_rx.next().await {
            match msg? {
                Message::Text(text) => {
                    let mut value: Value = serde_json::from_str(text.as_str())?;
                    observe_client(&value, &line_counts, &emit);
                    mapper.to_server(&mut value);
                    let body = serde_json::to_string(&value)?;
                    stdin
                        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
                        .await?;
                    stdin.write_all(body.as_bytes()).await?;
                    stdin.flush().await?;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        Ok::<_, BoxError>(())
    };

    let to_client = async {
        while let Some(body) = read_lsp_message(&mut stdout).await? {
            let mut value: Value = serde_json::from_slice(&body)?;
            mapper.to_client(&mut value);
            observe_server(&value, &line_counts, &emit);
            ws_tx.send(Message::Text(serde_json::to_string(&value)?.into())).await?;
        }
        emit(LeanStatus::Error {
            message: "The Lean server stopped unexpectedly.".into(),
        });
        Ok::<_, BoxError>(())
    };

    let result = tokio::select! {
        r = to_server => r,
        r = to_client => r,
    };
    let _ = child.kill().await;
    result
}

/// Watch client → server traffic for lifecycle events (URIs in client form).
fn observe_client(msg: &Value, line_counts: &Mutex<HashMap<String, usize>>, emit: &impl Fn(LeanStatus)) {
    let params = &msg["params"];
    match msg["method"].as_str() {
        Some("initialize") => emit(LeanStatus::Initializing),
        Some("textDocument/didOpen") => {
            let doc = &params["textDocument"];
            if let (Some(uri), Some(text)) = (doc["uri"].as_str(), doc["text"].as_str()) {
                line_counts
                    .lock()
                    .unwrap()
                    .insert(uri.to_string(), text.lines().count().max(1));
            }
        }
        Some("textDocument/didChange") => {
            // Only full-document changes carry the new length; incremental edits
            // keep the old count, which is close enough for a progress bar.
            let full = params["contentChanges"]
                .as_array()
                .and_then(|changes| changes.iter().rev().find(|c| c.get("range").is_none()));
            if let (Some(uri), Some(text)) = (
                params["textDocument"]["uri"].as_str(),
                full.and_then(|c| c["text"].as_str()),
            ) {
                line_counts
                    .lock()
                    .unwrap()
                    .insert(uri.to_string(), text.lines().count().max(1));
            }
        }
        _ => {}
    }
}

/// Watch server → client traffic (already mapped to client URIs).
fn observe_server(msg: &Value, line_counts: &Mutex<HashMap<String, usize>>, emit: &impl Fn(LeanStatus)) {
    if msg["result"]["capabilities"].is_object() {
        emit(LeanStatus::Initialized);
        return;
    }
    if msg["method"] != "$/lean/fileProgress" {
        return;
    }
    let params = &msg["params"];
    let Some(uri) = params["textDocument"]["uri"].as_str() else {
        return;
    };
    let processing = params["processing"].as_array().map(Vec::as_slice).unwrap_or_default();
    // Lean reports the ranges still being processed; the earliest start line
    // is how far it has got.
    let first_pending = processing
        .iter()
        .filter_map(|p| p["range"]["start"]["line"].as_u64())
        .min();
    match first_pending {
        None => emit(LeanStatus::FileReady { uri: uri.to_string() }),
        Some(line) => {
            let total = line_counts.lock().unwrap().get(uri).copied().unwrap_or(1);
            let progress = (line as f64 / total as f64).clamp(0.0, 0.99);
            emit(LeanStatus::Processing {
                uri: uri.to_string(),
                progress,
            });
        }
    }
}

/// Read one `Content-Length`-framed LSP message. `None` on clean EOF.
async fn read_lsp_message<R: AsyncBufRead + Unpin>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    let mut len = None;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 {
            return Ok(None);
        }
        let line = line.trim_end();
        if line.is_empty() {
            if len.is_some() {
                break;
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("Content-Length:") {
            len = v.trim().parse::<usize>().ok();
        }
    }
    let mut buf = vec![0; len.unwrap_or(0)];
    reader.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

struct UriMapper {
    /// e.g. `file:///C:/Users/me/AppData/Roaming/dev.leanlings.app/workspace/`
    server_prefix: String,
    server_prefix_lower: String,
    root_path: String,
}

impl UriMapper {
    fn new(workspace: &Path) -> Self {
        let server_prefix = url::Url::from_directory_path(workspace)
            .expect("workspace path is absolute")
            .to_string();
        Self {
            server_prefix_lower: server_prefix.to_lowercase(),
            server_prefix,
            root_path: workspace.display().to_string(),
        }
    }

    fn to_server(&self, value: &mut Value) {
        walk(value, &mut |key, s| match key {
            "rootPath" => Some(self.root_path.clone()),
            _ if URI_KEYS.contains(&key) => {
                let rest = s.strip_prefix(CLIENT_PREFIX)?;
                // Already a real path (e.g. a toolchain file the client opened
                // after go-to-definition): leave it alone.
                if looks_like_drive(rest) {
                    return None;
                }
                Some(format!("{}{rest}", self.server_prefix))
            }
            _ => None,
        });
    }

    fn to_client(&self, value: &mut Value) {
        walk(value, &mut |key, s| {
            if !URI_KEYS.contains(&key) {
                return None;
            }
            // Lean may echo the drive colon percent-encoded; normalise first.
            let decoded = s.replacen("%3A", ":", 1).replacen("%3a", ":", 1);
            if decoded.to_lowercase().starts_with(&self.server_prefix_lower) {
                Some(format!("{CLIENT_PREFIX}{}", &decoded[self.server_prefix.len()..]))
            } else {
                None
            }
        });
    }
}

fn looks_like_drive(rest: &str) -> bool {
    let b = rest.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && (b[1] == b':' || rest[1..].to_lowercase().starts_with("%3a"))
}

/// Visit every string value under an object key, replacing it when `f` returns `Some`.
fn walk(value: &mut Value, f: &mut impl FnMut(&str, &str) -> Option<String>) {
    match value {
        Value::Object(map) => {
            for (key, v) in map.iter_mut() {
                if let Value::String(s) = v {
                    if let Some(new) = f(key, s) {
                        *s = new;
                    }
                } else {
                    walk(v, f);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| walk(v, f)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mapper() -> UriMapper {
        let ws = if cfg!(windows) { r"C:\ws" } else { "/ws" };
        UriMapper::new(Path::new(ws))
    }

    #[test]
    fn round_trips_exercise_uris() {
        let m = mapper();
        let mut v = json!({"textDocument": {"uri": "file:///Exercises/a.lean"}});
        m.to_server(&mut v);
        let server_uri = v["textDocument"]["uri"].as_str().unwrap().to_string();
        assert!(server_uri.starts_with(&m.server_prefix) && server_uri.ends_with("Exercises/a.lean"));
        m.to_client(&mut v);
        assert_eq!(v["textDocument"]["uri"], "file:///Exercises/a.lean");
    }

    #[test]
    fn leaves_foreign_uris_alone() {
        let m = mapper();
        let mut v = json!({"uri": "file:///D:/toolchain/Init/Prelude.lean"});
        m.to_server(&mut v);
        assert_eq!(v["uri"], "file:///D:/toolchain/Init/Prelude.lean");
        m.to_client(&mut v);
        assert_eq!(v["uri"], "file:///D:/toolchain/Init/Prelude.lean");
    }
}
