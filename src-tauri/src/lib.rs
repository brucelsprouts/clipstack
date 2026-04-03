/// ClipStack — Tauri application entry point.
///
/// This file wires together all backend modules:
///   - `db`        — SQLite persistence
///   - `state`     — shared app state
///   - `clipboard` — background clipboard monitor
///   - `tray`      — system tray / menu bar icon
///   - `commands`  — Tauri IPC commands
mod clipboard;
mod commands;
mod db;
mod state;
mod tray;

use log::info;
use state::{AppState, Settings};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let mut app = tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────────────────────
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // Register the global shortcut plugin with an empty builder; the actual
        // shortcut string is registered after setup() so we can load it from DB.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // ── Commands ──────────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            commands::get_clips,
            commands::copy_clip,
            commands::toggle_pin,
            commands::delete_clip,
            commands::clear_all_clips,
            commands::get_settings,
            commands::update_settings,
            commands::hide_window,
            commands::toggle_window_cmd,
            commands::open_history_folder,
            commands::paste_and_hide,
            commands::reorder_clips,
            commands::open_url,
        ])
        // ── Setup ─────────────────────────────────────────────────────────────
        .setup(|app| {
            let handle = app.handle().clone();

            // 1. Open the SQLite database in the app data directory.
            let db_path = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory")
                .join("clipstack.db");

            info!("Opening database at: {}", db_path.display());

            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)
                    .expect("Failed to create app data directory");
            }

            let database =
                db::Database::open(&db_path).expect("Failed to open SQLite database");

            // 2. Load persisted settings from the database.
            let settings = load_settings_from_db(&database);
            let shortcut = settings.shortcut.clone();

            // 3. Start clipboard monitor thread — keep its running flag.
            let monitor_running: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
            let monitor_flag = clipboard::start_monitor(handle.clone());
            // Propagate the real flag into our Arc wrapper.
            monitor_running.store(monitor_flag.load(Ordering::Relaxed), Ordering::Relaxed);

            // 4. Inject shared state into Tauri's managed state.
            app.manage(AppState {
                db: Mutex::new(database),
                settings: Mutex::new(settings),
                monitor_running: monitor_flag,
                last_written_content: Mutex::new(None),
            });

            // 5. Register the global keyboard shortcut.
            let handle_shortcut = handle.clone();
            if let Err(e) = handle.global_shortcut().on_shortcut(
                shortcut.as_str(),
                move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        tray::toggle_window(&handle_shortcut);
                    }
                },
            ) {
                log::warn!("Could not register shortcut '{}': {e}", shortcut);
            }

            // 6. Set up system tray.
            tray::setup_tray(&handle).expect("Failed to create system tray");

            // 7. Auto-hide the window when it loses focus (click outside).
            //    A small debounce prevents spurious hides caused by internal
            //    focus shifts (dialogs, input fields, etc.).
            if let Some(main_win) = app.get_webview_window("main") {
                let win_clone = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let win = win_clone.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(80));
                            if !win.is_focused().unwrap_or(true) {
                                let _ = win.hide();
                            }
                        });
                    }
                });
            }

            // 8. Autostart is managed entirely from the frontend via
            // @tauri-apps/plugin-autostart JS API (enable/disable).
            // The plugin init above registers the capability; the frontend
            // toggles it when the user changes the setting.

            info!("ClipStack is running.");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Failed to build ClipStack");

    // Hide the dock icon on macOS — the app lives only in the menu bar.
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    app.run(|_app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            // Prevent the app from quitting when the window is closed.
            // It keeps running in the tray / menu bar.
            api.prevent_exit();
        }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Load all settings from the database, falling back to defaults for any key
/// that hasn't been persisted yet.
fn load_settings_from_db(db: &db::Database) -> Settings {
    let mut settings = Settings::default();

    if let Ok(Some(v)) = db.get_setting("shortcut") {
        settings.shortcut = v;
    }
    if let Ok(Some(v)) = db.get_setting("max_history") {
        if let Ok(n) = v.parse::<u32>() {
            settings.max_history = n;
        }
    }
    if let Ok(Some(v)) = db.get_setting("launch_at_startup") {
        settings.launch_at_startup = v == "1";
    }
    if let Ok(Some(v)) = db.get_setting("excluded_apps") {
        if let Ok(apps) = serde_json::from_str::<Vec<String>>(&v) {
            settings.excluded_apps = apps;
        }
    }
    if let Ok(Some(v)) = db.get_setting("theme") {
        settings.theme = v;
    }

    settings
}

