/// Tauri commands exposed to the React frontend.
///
/// All frontend ↔ backend communication goes through these typed commands.
/// Each command validates its inputs, delegates to the appropriate module,
/// and returns a serialisable result or a user-friendly error string.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::{AppHandle, Manager, State};

use crate::{
    db::{Clip, ClipKind},
    state::{AppState, Settings},
    tray::toggle_window,
};

// ─── Type aliases ─────────────────────────────────────────────────────────────

/// All commands return `Result<T, String>` — the `String` error is forwarded
/// to the frontend where it can be displayed to the user.
type CmdResult<T> = Result<T, String>;

// ─── Clip commands ────────────────────────────────────────────────────────────

/// Retrieve clipboard history, optionally filtered by a search string.
/// A limit of 0 means unlimited (returns all clips).
#[tauri::command]
pub fn get_clips(
    state: State<'_, AppState>,
    search: Option<String>,
    limit: Option<u32>,
) -> CmdResult<Vec<Clip>> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // 0 = unlimited; otherwise cap at 5000 to prevent runaway memory usage.
    let limit = match limit.unwrap_or(500) {
        0 => u32::MAX,
        n => n.min(5000),
    };
    db.get_clips(search.as_deref(), limit)
        .map_err(|e| e.to_string())
}

/// Copy a clip's content back to the system clipboard.
#[tauri::command]
pub fn copy_clip(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    let clip = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_clips(None, 1000)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("Clip {} not found", id))?
    };

    // Record the content so the clipboard monitor skips re-saving this write.
    {
        let mut written = state.last_written_content.lock().map_err(|e| e.to_string())?;
        *written = Some(clip.content.clone());
    }

    write_to_clipboard(&clip).map_err(|e| e.to_string())
}

/// Toggle the pinned state of a clip.
#[tauri::command]
pub fn toggle_pin(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.toggle_pin(id).map_err(|e| e.to_string())
}

/// Delete a single clip.
#[tauri::command]
pub fn delete_clip(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_clip(id).map_err(|e| e.to_string())
}

/// Delete all clips (called after frontend confirmation).
#[tauri::command]
pub fn clear_all_clips(state: State<'_, AppState>) -> CmdResult<()> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_all_clips().map_err(|e| e.to_string())
}

/// Persist a drag-reordered sequence for one clip group (pinned or regular).
#[tauri::command]
pub fn reorder_clips(state: State<'_, AppState>, ordered_ids: Vec<i64>) -> CmdResult<()> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.reorder_clips(&ordered_ids).map_err(|e| e.to_string())
}

// ─── Settings commands ────────────────────────────────────────────────────────

/// Return the current settings object to the frontend.
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CmdResult<SettingsDto> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(SettingsDto::from(&*settings))
}

/// Persist updated settings. Each field is applied individually so partial
/// updates (e.g. only changing the shortcut) work without re-sending everything.
#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: SettingsDto,
) -> CmdResult<()> {
    // Re-register the global shortcut if it changed.
    let old_shortcut = {
        let s = state.settings.lock().map_err(|e| e.to_string())?;
        s.shortcut.clone()
    };

    if old_shortcut != payload.shortcut {
        re_register_shortcut(&app, &old_shortcut, &payload.shortcut)?;
    }

    // Persist to DB and update in-memory state.
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut settings = state.settings.lock().map_err(|e| e.to_string())?;

        settings.shortcut = payload.shortcut.clone();
        settings.max_history = payload.max_history;
        settings.launch_at_startup = payload.launch_at_startup;
        settings.excluded_apps = payload.excluded_apps.clone();
        settings.theme = payload.theme.clone();

        db.set_setting("shortcut", &payload.shortcut)
            .map_err(|e| e.to_string())?;
        db.set_setting("max_history", &payload.max_history.to_string())
            .map_err(|e| e.to_string())?;
        db.set_setting(
            "launch_at_startup",
            if payload.launch_at_startup { "1" } else { "0" },
        )
        .map_err(|e| e.to_string())?;
        db.set_setting(
            "excluded_apps",
            &serde_json::to_string(&payload.excluded_apps).unwrap_or_default(),
        )
        .map_err(|e| e.to_string())?;
        db.set_setting("theme", &payload.theme)
            .map_err(|e| e.to_string())?;
    }

    // Autostart is toggled from the frontend via @tauri-apps/plugin-autostart
    // (the JS API). The backend only persists the preference to SQLite here.

    Ok(())
}

// ─── Window commands ──────────────────────────────────────────────────────────

/// Hide the main window (called from the frontend when the user presses Escape).
#[tauri::command]
pub fn hide_window(app: AppHandle) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Toggle window visibility (also triggered by the global shortcut).
#[tauri::command]
pub fn toggle_window_cmd(app: AppHandle) -> CmdResult<()> {
    toggle_window(&app);
    Ok(())
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

/// Frontend-facing settings shape. Uses camelCase via serde rename.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub shortcut: String,
    pub max_history: u32,
    pub launch_at_startup: bool,
    pub excluded_apps: Vec<String>,
    pub theme: String,
}

impl From<&Settings> for SettingsDto {
    fn from(s: &Settings) -> Self {
        Self {
            shortcut: s.shortcut.clone(),
            max_history: s.max_history,
            launch_at_startup: s.launch_at_startup,
            excluded_apps: s.excluded_apps.clone(),
            theme: s.theme.clone(),
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Write a clip's content back to the OS clipboard.
fn write_to_clipboard(clip: &Clip) -> Result<(), Box<dyn std::error::Error>> {
    match clip.kind {
        ClipKind::Text => write_text_to_clipboard(&clip.content),
        ClipKind::Html => {
            let plain = crate::clipboard::strip_html_tags(&clip.content);
            write_html_to_clipboard(&clip.content, &plain)
        }
        ClipKind::Image => write_image_to_clipboard(&clip.content),
    }
}

#[cfg(target_os = "macos")]
fn write_text_to_clipboard(text: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("pbcopy").stdin(Stdio::piped()).spawn()?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(text.as_bytes())?;
    }
    child.wait()?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn write_text_to_clipboard(text: &str) -> Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::{
        Foundation::HANDLE,
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::CF_UNICODETEXT,
        },
        UI::WindowsAndMessaging::GetDesktopWindow,
    };

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let size = wide.len() * std::mem::size_of::<u16>();

    unsafe {
        OpenClipboard(GetDesktopWindow())?;
        EmptyClipboard()?;
        let h = GlobalAlloc(GMEM_MOVEABLE, size)?;
        let ptr = GlobalLock(h);
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr as *mut u16, wide.len());
        GlobalUnlock(h).ok();
        SetClipboardData(CF_UNICODETEXT.0 as u32, HANDLE(h.0))?;
        CloseClipboard()?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn write_text_to_clipboard(_text: &str) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn write_html_to_clipboard(html: &str, plain: &str) -> Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::{
        Foundation::HANDLE,
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::CF_UNICODETEXT,
        },
        UI::WindowsAndMessaging::GetDesktopWindow,
    };
    use windows::core::w;

    let cf_html_str = build_cf_html(html);
    // CF_HTML is a UTF-8 null-terminated byte string.
    let cf_html_bytes: Vec<u8> = cf_html_str.bytes().chain(std::iter::once(0)).collect();
    let wide: Vec<u16> = plain.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let html_format = RegisterClipboardFormatW(w!("HTML Format"));
        OpenClipboard(GetDesktopWindow())?;
        EmptyClipboard()?;

        if html_format != 0 {
            let h = GlobalAlloc(GMEM_MOVEABLE, cf_html_bytes.len())?;
            let ptr = GlobalLock(h);
            std::ptr::copy_nonoverlapping(cf_html_bytes.as_ptr(), ptr as *mut u8, cf_html_bytes.len());
            GlobalUnlock(h).ok();
            SetClipboardData(html_format, HANDLE(h.0))?;
        }

        // Also set plain text so apps that don't understand HTML can still paste.
        let size = wide.len() * std::mem::size_of::<u16>();
        let h = GlobalAlloc(GMEM_MOVEABLE, size)?;
        let ptr = GlobalLock(h);
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr as *mut u16, wide.len());
        GlobalUnlock(h).ok();
        SetClipboardData(CF_UNICODETEXT.0 as u32, HANDLE(h.0))?;

        CloseClipboard()?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn write_html_to_clipboard(html: &str, plain: &str) -> Result<(), Box<dyn std::error::Error>> {
    // macOS: pbcopy only sets plain text; write the plain fallback.
    let _ = html;
    write_text_to_clipboard(plain)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn write_html_to_clipboard(_html: &str, _plain: &str) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

/// Decode a base64-encoded PNG/BMP and write it to the clipboard as image data.
/// Writes both the binary image format (CF_DIB for BMP, "PNG" custom for PNG) and
/// an HTML Format entry with an <img> element so web-based editors can paste it.
fn write_image_to_clipboard(b64: &str) -> Result<(), Box<dyn std::error::Error>> {
    let bytes = B64.decode(b64)?;
    write_image_bytes_to_clipboard(b64, &bytes)
}

#[cfg(target_os = "windows")]
fn write_image_bytes_to_clipboard(b64: &str, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::{
        Foundation::HANDLE,
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::CF_DIB,
        },
        UI::WindowsAndMessaging::GetDesktopWindow,
    };
    use windows::core::w;

    let is_bmp = bytes.starts_with(b"BM");
    let mime = if is_bmp { "image/bmp" } else { "image/png" };

    // Build HTML clipboard entry: <img> lets web-based editors (Gmail, Docs, etc.)
    // paste the image as a proper element rather than receiving nothing or raw text.
    let html_img = format!(r#"<img src="data:{};base64,{}">"#, mime, b64);
    let cf_html_str = build_cf_html(&html_img);
    let cf_html_bytes: Vec<u8> = cf_html_str.bytes().chain(std::iter::once(0)).collect();

    unsafe {
        let html_format = RegisterClipboardFormatW(w!("HTML Format"));
        let png_format  = if !is_bmp { RegisterClipboardFormatW(w!("PNG")) } else { 0 };

        OpenClipboard(GetDesktopWindow())?;
        EmptyClipboard()?;

        // Write binary image data so native apps (Paint, Photoshop, Word …) can paste.
        if is_bmp && bytes.len() > 14 {
            // CF_DIB: strip the 14-byte BITMAPFILEHEADER — apps expect raw DIB.
            let dib = &bytes[14..];
            let h = GlobalAlloc(GMEM_MOVEABLE, dib.len())?;
            let ptr = GlobalLock(h);
            std::ptr::copy_nonoverlapping(dib.as_ptr(), ptr as *mut u8, dib.len());
            GlobalUnlock(h).ok();
            SetClipboardData(CF_DIB.0 as u32, HANDLE(h.0))?;
        } else if !is_bmp && png_format != 0 {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
            let ptr = GlobalLock(h);
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
            GlobalUnlock(h).ok();
            SetClipboardData(png_format, HANDLE(h.0))?;
        }

        // Write HTML Format with <img> for web-based editors.
        if html_format != 0 {
            let h = GlobalAlloc(GMEM_MOVEABLE, cf_html_bytes.len())?;
            let ptr = GlobalLock(h);
            std::ptr::copy_nonoverlapping(cf_html_bytes.as_ptr(), ptr as *mut u8, cf_html_bytes.len());
            GlobalUnlock(h).ok();
            SetClipboardData(html_format, HANDLE(h.0))?;
        }

        CloseClipboard()?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn write_image_bytes_to_clipboard(_b64: &str, _bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    // macOS image clipboard requires Objective-C bindings; not supported yet.
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn write_image_bytes_to_clipboard(_b64: &str, _bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

/// Build a Windows CF_HTML clipboard format string with correct byte offsets.
fn build_cf_html(html: &str) -> String {
    // The header uses fixed-width 8-digit decimal byte offsets.
    const HEADER: &str = "Version:0.9\r\nStartHTML:00000000\r\nEndHTML:00000000\r\nStartFragment:00000000\r\nEndFragment:00000000\r\n";
    const OPEN: &str = "<html><body>\r\n<!--StartFragment-->";
    const CLOSE: &str = "<!--EndFragment-->\r\n</body></html>";

    let start_html = HEADER.len();
    let start_frag = start_html + OPEN.len();
    let end_frag = start_frag + html.len();
    let end_html = end_frag + CLOSE.len();

    format!(
        "Version:0.9\r\nStartHTML:{:08}\r\nEndHTML:{:08}\r\nStartFragment:{:08}\r\nEndFragment:{:08}\r\n{}{}{}",
        start_html, end_html, start_frag, end_frag, OPEN, html, CLOSE
    )
}

/// Unregister the old shortcut and register the new one.
fn re_register_shortcut(app: &AppHandle, old: &str, new: &str) -> CmdResult<()> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    if app.global_shortcut().is_registered(old) {
        app.global_shortcut()
            .unregister(old)
            .map_err(|e| e.to_string())?;
    }

    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(new, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_window(&app_clone);
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}


/// Open the app data directory (where clipstack.db lives) in the system file manager.
/// Also writes a human-readable history.txt export alongside the database.
#[tauri::command]
pub fn open_history_folder(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    // Export clips to a human-readable JSON file.
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if let Ok(clips) = db.get_clips(None, u32::MAX) {
            #[derive(serde::Serialize)]
            struct ClipEntry {
                id: i64,
                kind: &'static str,
                content: String,
                created_at: String,
                pinned: bool,
                preview: String,
            }

            let entries: Vec<ClipEntry> = clips
                .iter()
                .map(|c| {
                    let created_at = chrono::DateTime::from_timestamp_millis(c.created_at)
                        .map(|dt| {
                            dt.with_timezone(&chrono::Local)
                                .format("%Y-%m-%d %H:%M:%S")
                                .to_string()
                        })
                        .unwrap_or_else(|| "unknown".into());
                    let kind = match c.kind {
                        crate::db::ClipKind::Text => "text",
                        crate::db::ClipKind::Image => "image",
                        crate::db::ClipKind::Html => "html",
                    };
                    ClipEntry {
                        id: c.id,
                        kind,
                        content: if c.kind == crate::db::ClipKind::Image {
                            format!("[base64 image, {} bytes]", c.content.len())
                        } else {
                            c.content.clone()
                        },
                        created_at,
                        pinned: c.pinned,
                        preview: c.preview.clone(),
                    }
                })
                .collect();

            if let Ok(json) = serde_json::to_string_pretty(&entries) {
                let _ = std::fs::write(path.join("history.json"), json);
            }
        }
    }

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Hides the main window then sends a paste keystroke to the previously focused app.
/// Called after the frontend finishes its exit animation.
#[tauri::command]
pub fn paste_and_hide(app: AppHandle) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(120));
        send_paste();
    });
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_paste() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };
    unsafe {
        keybd_event(VK_CONTROL.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_V.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_V.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

#[cfg(target_os = "macos")]
fn send_paste() {
    let _ = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .spawn();
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn send_paste() {}
