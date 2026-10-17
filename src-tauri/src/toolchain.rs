//! Finding elan and installing the Lean toolchain the workspace pins.
//!
//! elan would download a missing toolchain on the first `lake` call anyway,
//! but silently (the loading screen just sat on "Launching lake serve…"), so
//! the frontend checks first and asks before installing.

use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// `$ELAN_HOME`, or `~/.elan`.
fn elan_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("ELAN_HOME") {
        return Some(home.into());
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(Path::new(&home).join(".elan"))
}

/// `PATH` with elan's `bin` directory appended. Apps launched from Finder or
/// the Dock on macOS don't inherit the shell's `PATH`, so `lake` and `elan`
/// wouldn't be found otherwise.
fn search_path() -> OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(bin) = elan_home().map(|h| h.join("bin"))
        && !dirs.contains(&bin)
    {
        dirs.push(bin);
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// A command for an elan-managed tool (`lake`, `elan`), without a console
/// window on Windows.
pub fn command(program: &str) -> Command {
    let path = search_path();
    // `Command::new` resolves the program against the parent's PATH, not the
    // one passed via `env`, so resolve it ourselves.
    let exe = std::env::split_paths(&path)
        .flat_map(|dir| {
            let base = dir.join(program);
            [base.with_extension(std::env::consts::EXE_EXTENSION), base]
        })
        .find(|p| p.is_file())
        .unwrap_or_else(|| program.into());
    let mut cmd = Command::new(exe);
    cmd.env("PATH", path);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    /// e.g. `leanprover/lean4:v4.35.0`
    pub toolchain: String,
    pub elan_found: bool,
    pub installed: bool,
}

pub fn pinned(workspace: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(workspace.join("lean-toolchain")).map_err(|e| e.to_string())?;
    Ok(text.trim().to_string())
}

pub async fn status(workspace: &Path) -> Result<ToolchainStatus, String> {
    let toolchain = pinned(workspace)?;
    let Ok(out) = command("elan").args(["toolchain", "list"]).output().await else {
        return Ok(ToolchainStatus {
            toolchain,
            elan_found: false,
            installed: false,
        });
    };
    // Lines look like `leanprover/lean4:v4.35.0` or `… (default)`.
    let installed = String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|l| l.split_whitespace().next() == Some(toolchain.as_str()));
    Ok(ToolchainStatus {
        toolchain,
        elan_found: true,
        installed,
    })
}

/// Progress of [`install`], emitted as `toolchain-progress` events.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    /// Bytes in elan's temp directory (download + extraction). elan prints no
    /// progress when its output isn't a terminal, so this is the best signal.
    bytes: u64,
}

pub async fn install(workspace: &Path, app: &AppHandle) -> Result<(), String> {
    let toolchain = pinned(workspace)?;
    let mut child = command("elan")
        .args(["toolchain", "install", &toolchain])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("could not run `elan`: {e}"))?;
    let mut stderr = child.stderr.take().expect("piped stderr");
    let read_stderr = async {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s).await;
        s
    };
    let tmp = elan_home().map(|h| h.join("tmp"));
    let wait = async {
        loop {
            tokio::select! {
                status = child.wait() => break status,
                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    if let Some(tmp) = &tmp {
                        let _ = app.emit("toolchain-progress", InstallProgress { bytes: dir_size(tmp) });
                    }
                }
            }
        }
    };
    let (status, log) = tokio::join!(wait, read_stderr);
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err(format!("`elan toolchain install {toolchain}` failed:\n{}", log.trim())),
        Err(e) => Err(e.to_string()),
    }
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}
