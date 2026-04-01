/// Global application state managed by Tauri.
///
/// Everything that needs to live for the lifetime of the app and be
/// accessible from Tauri commands goes here.
use std::sync::{
    atomic::AtomicBool,
    Arc, Mutex,
};

use crate::db::Database;

// ─── Settings ────────────────────────────────────────────────────────────────

/// Runtime settings (kept in memory, persisted to SQLite on change).
#[derive(Debug, Clone)]
pub struct Settings {
    /// Global keyboard shortcut string, e.g. `"CommandOrControl+Shift+V"`.
    pub shortcut: String,
    /// Maximum number of non-pinned clips to retain.
    pub max_history: u32,
    /// Whether to launch the app on system startup.
    pub launch_at_startup: bool,
    /// Apps (by process name) whose clipboard events should be ignored.
    pub excluded_apps: Vec<String>,
    /// Optional theme override: "system" | "dark" | "light"
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "CommandOrControl+Shift+V".to_string(),
            max_history: 500,
            launch_at_startup: true,
            excluded_apps: Vec::new(),
            theme: "system".to_string(),
        }
    }
}

// ─── AppState ────────────────────────────────────────────────────────────────

/// The single shared state container injected via `app.manage()`.
pub struct AppState {
    pub db: Mutex<Database>,
    pub settings: Mutex<Settings>,
    /// Flag used to stop the clipboard monitor thread gracefully.
    pub monitor_running: Arc<AtomicBool>,
    /// Content most recently written to the clipboard by `copy_clip`.
    /// The monitor checks this to avoid re-saving a clip that the app itself wrote.
    pub last_written_content: Mutex<Option<String>>,
}
