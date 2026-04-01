/// Clipboard monitoring for ClipStack.
///
/// This module owns a background thread that polls the OS clipboard at a
/// fixed interval. When a change is detected the new content is saved to the
/// database and a `clip-added` event is emitted to the frontend window.
///
/// A simple change-detection hash (SHA-256 via a rolling comparison) avoids
/// storing duplicate consecutive copies without any heavyweight logic.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use log::{error, warn};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    db::ClipKind,
    state::AppState,
};

/// How often to check the clipboard (milliseconds). 500ms is imperceptible
/// to users yet extremely lightweight on CPU.
const POLL_INTERVAL_MS: u64 = 500;

/// Maximum byte size for clipboard text we will store (1 MB).
const MAX_TEXT_BYTES: usize = 1_048_576;

/// Maximum byte size for clipboard images we will store (10 MB raw PNG).
const MAX_IMAGE_BYTES: usize = 10_485_760;

// ─── Public API ───────────────────────────────────────────────────────────────

/// Start the background clipboard monitor thread.
/// The returned `Arc<AtomicBool>` can be set to `false` to stop the thread.
pub fn start_monitor(app: AppHandle) -> Arc<AtomicBool> {
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    thread::spawn(move || {
        monitor_loop(app, running_clone);
    });

    running
}

// ─── Internal ─────────────────────────────────────────────────────────────────

fn monitor_loop(app: AppHandle, running: Arc<AtomicBool>) {
    let mut last_text: Option<String> = None;
    let mut last_image_hash: Option<u64> = None;
    let mut last_html_hash: Option<u64> = None;

    while running.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

        // --- Rich HTML (checked before plain text — higher fidelity) ---
        if let Ok(Some(html)) = read_clipboard_html() {
            if html.len() > MAX_TEXT_BYTES {
                warn!("Clipboard HTML too large ({} bytes), skipping.", html.len());
                continue;
            }
            let hash = quick_hash(html.as_bytes());
            if Some(hash) != last_html_hash {
                last_html_hash = Some(hash);
                // Also update last_text to the stripped plain-text equivalent so
                // a subsequent plain-text poll for the same copy event is skipped.
                last_text = Some(strip_html_tags(&html).split_whitespace().collect::<Vec<_>>().join(" "));
                save_html_clip(&app, html);
            }
            continue; // HTML and plain text co-exist; skip redundant text check.
        }

        // --- Plain text ---
        if let Ok(text) = read_clipboard_text() {
            let text = text.trim().to_string();
            if !text.is_empty() && Some(&text) != last_text.as_ref() {
                last_text = Some(text.clone());
                if text.len() <= MAX_TEXT_BYTES {
                    save_text_clip(&app, text);
                } else {
                    warn!("Clipboard text too large ({} bytes), skipping.", text.len());
                }
            }
            continue; // If there's text, skip image check this cycle.
        }

        // --- Image (only checked when clipboard has no text/html) ---
        if let Ok(Some(png_bytes)) = read_clipboard_image() {
            if png_bytes.len() > MAX_IMAGE_BYTES {
                warn!("Clipboard image too large ({} bytes), skipping.", png_bytes.len());
                continue;
            }
            let hash = quick_hash(&png_bytes);
            if Some(hash) != last_image_hash {
                last_image_hash = Some(hash);
                save_image_clip(&app, png_bytes);
            }
        }
    }
}

// ── Clipboard reading ─────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn read_clipboard_text() -> Result<String, ()> {
    use std::process::Command;
    let output = Command::new("pbpaste").output().map_err(|_| ())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(())
    }
}

#[cfg(target_os = "windows")]
fn read_clipboard_text() -> Result<String, ()> {
    use windows::Win32::{
        System::{
            DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
            Memory::{GlobalLock, GlobalUnlock},
            Ole::CF_UNICODETEXT,
        },
        UI::WindowsAndMessaging::GetDesktopWindow,
    };

    unsafe {
        if OpenClipboard(GetDesktopWindow()).is_err() {
            return Err(());
        }
        let handle = GetClipboardData(CF_UNICODETEXT.0 as u32);
        let result = match handle {
            Ok(h) if !h.is_invalid() => {
                let ptr = GlobalLock(windows::Win32::Foundation::HGLOBAL(h.0));
                if ptr.is_null() {
                    Err(())
                } else {
                    let wide: *const u16 = ptr as *const u16;
                    let mut len = 0usize;
                    while *wide.add(len) != 0 {
                        len += 1;
                    }
                    let slice = std::slice::from_raw_parts(wide, len);
                    let text = String::from_utf16_lossy(slice);
                    GlobalUnlock(windows::Win32::Foundation::HGLOBAL(h.0)).ok();
                    Ok(text)
                }
            }
            _ => Err(()),
        };
        CloseClipboard().ok();
        result
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn read_clipboard_text() -> Result<String, ()> {
    Err(()) // Linux / other platforms — not supported in this release.
}

#[cfg(target_os = "macos")]
fn read_clipboard_image() -> Result<Option<Vec<u8>>, ()> {
    Ok(None) // Requires Objective-C bindings; not supported in this release.
}

#[cfg(target_os = "windows")]
fn read_clipboard_image() -> Result<Option<Vec<u8>>, ()> {
    use windows::Win32::{
        System::{
            DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW},
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
            Ole::CF_DIB,
        },
        UI::WindowsAndMessaging::GetDesktopWindow,
    };
    use windows::core::w;

    unsafe {
        if OpenClipboard(GetDesktopWindow()).is_err() {
            return Err(());
        }

        // Prefer PNG (placed by browsers and image editors) — already valid image bytes.
        let png_format = RegisterClipboardFormatW(w!("PNG"));
        if png_format != 0 {
            if let Ok(h) = GetClipboardData(png_format) {
                if !h.is_invalid() {
                    let hglobal = windows::Win32::Foundation::HGLOBAL(h.0);
                    let ptr = GlobalLock(hglobal);
                    if !ptr.is_null() {
                        let size = GlobalSize(hglobal);
                        let bytes = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
                        GlobalUnlock(hglobal).ok();
                        CloseClipboard().ok();
                        return Ok(Some(bytes));
                    }
                }
            }
        }

        // Fall back to CF_DIB (screenshots, Paint, most Windows apps).
        // Wrap the raw BITMAPINFO blob in a BITMAPFILEHEADER to get a valid BMP.
        let result = match GetClipboardData(CF_DIB.0 as u32) {
            Ok(h) if !h.is_invalid() => {
                let hglobal = windows::Win32::Foundation::HGLOBAL(h.0);
                let ptr = GlobalLock(hglobal);
                if ptr.is_null() {
                    Ok(None)
                } else {
                    let size = GlobalSize(hglobal);
                    let dib = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
                    GlobalUnlock(hglobal).ok();
                    Ok(dib_to_bmp(&dib))
                }
            }
            _ => Ok(None),
        };
        CloseClipboard().ok();
        result
    }
}

/// Wrap a raw CF_DIB blob (BITMAPINFOHEADER + optional color table + pixel bits)
/// in a BITMAPFILEHEADER, producing a valid BMP byte sequence.
///
/// Pixel-offset rules (critical — wrong offset → corrupt image):
///   - BITMAPINFOHEADER (size=40) + BI_BITFIELDS: 3 DWORD masks sit *between*
///     the header and the pixel bits  → +12 bytes.
///   - Extended headers V4 (108) / V5 (124) + BI_BITFIELDS: masks are *inside*
///     the header struct → no extra bytes between header and pixel bits.
///   - Indexed color (bitCount ≤ 8): biClrUsed entries (or 2^bitCount) × 4 bytes.
#[cfg(target_os = "windows")]
fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let header_size = u32::from_le_bytes([dib[0],  dib[1],  dib[2],  dib[3]])  as usize;
    let bit_count   = u16::from_le_bytes([dib[14], dib[15]]);
    let compression = u32::from_le_bytes([dib[16], dib[17], dib[18], dib[19]]);
    let clr_used    = u32::from_le_bytes([dib[32], dib[33], dib[34], dib[35]]) as usize;

    let color_table_entries: usize = if bit_count > 8 {
        // BI_BITFIELDS masks only trail the header for the base 40-byte struct.
        // V4/V5 extended headers embed them internally — no trailing entries.
        if header_size == 40 && compression == 3 /* BI_BITFIELDS */ { 3 } else { 0 }
    } else {
        // Indexed color: respect biClrUsed when set, else full palette.
        if clr_used > 0 { clr_used } else { 1usize << bit_count }
    };

    let pixel_offset = 14usize + header_size + color_table_entries * 4;
    let file_size    = 14usize + dib.len();

    let mut bmp = Vec::with_capacity(file_size);
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&(file_size as u32).to_le_bytes());
    bmp.extend_from_slice(&0u16.to_le_bytes()); // reserved1
    bmp.extend_from_slice(&0u16.to_le_bytes()); // reserved2
    bmp.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Some(bmp)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn read_clipboard_image() -> Result<Option<Vec<u8>>, ()> {
    Ok(None)
}

// ── HTML clipboard reading ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn read_clipboard_html() -> Result<Option<String>, ()> {
    use windows::Win32::{
        System::{
            DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW},
            Memory::{GlobalLock, GlobalUnlock},
        },
        UI::WindowsAndMessaging::GetDesktopWindow,
    };
    use windows::core::w;

    unsafe {
        let format = RegisterClipboardFormatW(w!("HTML Format"));
        if format == 0 {
            return Ok(None);
        }
        if OpenClipboard(GetDesktopWindow()).is_err() {
            return Err(());
        }
        let result = match GetClipboardData(format) {
            Ok(h) if !h.is_invalid() => {
                let ptr = GlobalLock(windows::Win32::Foundation::HGLOBAL(h.0));
                if ptr.is_null() {
                    Ok(None)
                } else {
                    let raw = std::ffi::CStr::from_ptr(ptr as *const i8)
                        .to_string_lossy()
                        .into_owned();
                    GlobalUnlock(windows::Win32::Foundation::HGLOBAL(h.0)).ok();
                    Ok(extract_html_fragment(&raw).filter(|s| is_rich_html(s)))
                }
            }
            _ => Ok(None),
        };
        CloseClipboard().ok();
        result
    }
}

#[cfg(not(target_os = "windows"))]
fn read_clipboard_html() -> Result<Option<String>, ()> {
    Ok(None) // HTML clipboard reading requires platform-specific bindings.
}

/// Parse the byte offsets in the Windows CF_HTML header and return the fragment.
fn extract_html_fragment(cf_html: &str) -> Option<String> {
    let start = cf_html
        .find("StartFragment:")
        .and_then(|i| cf_html[i + "StartFragment:".len()..].split_whitespace().next())
        .and_then(|s| s.parse::<usize>().ok())?;
    let end = cf_html
        .find("EndFragment:")
        .and_then(|i| cf_html[i + "EndFragment:".len()..].split_whitespace().next())
        .and_then(|s| s.parse::<usize>().ok())?;

    let bytes = cf_html.as_bytes();
    if start >= bytes.len() || end > bytes.len() || start >= end {
        return None;
    }
    let fragment = std::str::from_utf8(&bytes[start..end]).ok()?;
    Some(fragment.trim().to_string())
}

/// Returns true if the HTML contains meaningful rich formatting (not just plain
/// text wrapped in bare `<p>` tags by a word processor).
fn is_rich_html(html: &str) -> bool {
    const RICH_TAGS: &[&str] = &[
        "<b>", "<b ", "<strong", "<i>", "<i ", "<em>", "<em ",
        "<table", "<ul", "<ol", "<li", "<img", "<a href",
        "<h1", "<h2", "<h3", "<h4", "<h5", "<h6",
        "style=\"", "style='",
    ];
    let lower = html.to_lowercase();
    RICH_TAGS.iter().any(|tag| lower.contains(tag))
}

// ── Saving ────────────────────────────────────────────────────────────────────

fn save_text_clip(app: &AppHandle, text: String) {
    let state = app.state::<AppState>();

    // Skip content the app itself just wrote via copy_clip (consumes the flag).
    {
        let mut written = state.last_written_content.lock().unwrap();
        if written.as_deref() == Some(text.as_str()) {
            *written = None;
            return;
        }
    }

    let db_guard = state.db.lock().unwrap();

    // Deduplicate: skip if identical to the last stored clip.
    match db_guard.last_clip_content() {
        Ok(Some(last)) if last == text => return,
        _ => {}
    }

    let preview = make_text_preview(&text);
    let max_history = state.settings.lock().unwrap().max_history;

    match db_guard.insert_clip(&ClipKind::Text, &text, &preview) {
        Ok(_) => {
            if let Err(e) = db_guard.prune_to_limit(max_history) {
                error!("Failed to prune history: {e}");
            }
            let _ = app.emit("clip-added", ());
        }
        Err(e) => error!("Failed to save text clip: {e}"),
    }
}

fn save_image_clip(app: &AppHandle, png_bytes: Vec<u8>) {
    let state = app.state::<AppState>();
    let db_guard = state.db.lock().unwrap();
    let b64 = B64.encode(&png_bytes);
    let preview = format!("Image ({} KB)", png_bytes.len() / 1024);
    let max_history = state.settings.lock().unwrap().max_history;

    match db_guard.insert_clip(&ClipKind::Image, &b64, &preview) {
        Ok(_) => {
            if let Err(e) = db_guard.prune_to_limit(max_history) {
                error!("Failed to prune history: {e}");
            }
            let _ = app.emit("clip-added", ());
        }
        Err(e) => error!("Failed to save image clip: {e}"),
    }
}

fn save_html_clip(app: &AppHandle, html: String) {
    let state = app.state::<AppState>();

    // Skip content the app itself just wrote via copy_clip (consumes the flag).
    {
        let mut written = state.last_written_content.lock().unwrap();
        if written.as_deref() == Some(html.as_str()) {
            *written = None;
            return;
        }
    }

    let db_guard = state.db.lock().unwrap();

    match db_guard.last_clip_content() {
        Ok(Some(last)) if last == html => return,
        _ => {}
    }

    let plain = strip_html_tags(&html);
    let preview = make_text_preview(&plain);
    let max_history = state.settings.lock().unwrap().max_history;

    match db_guard.insert_clip(&ClipKind::Html, &html, &preview) {
        Ok(_) => {
            if let Err(e) = db_guard.prune_to_limit(max_history) {
                error!("Failed to prune history: {e}");
            }
            let _ = app.emit("clip-added", ());
        }
        Err(e) => error!("Failed to save HTML clip: {e}"),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Strip HTML tags, returning plain text (used for previews and clipboard fallback).
pub(crate) fn strip_html_tags(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => { in_tag = false; result.push(' '); }
            _ if !in_tag => result.push(c),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Produce a short preview string from text content.
fn make_text_preview(text: &str) -> String {
    let normalized: String = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if normalized.chars().count() > 200 {
        let truncated: String = normalized.chars().take(197).collect();
        format!("{}...", truncated)
    } else {
        normalized
    }
}

/// A fast non-cryptographic hash for change detection.
/// Uses DefaultHasher (SipHash-1-3 with fixed zero keys) for deterministic results
/// within a process run — RandomState must NOT be used here as it re-seeds on every call.
fn quick_hash(data: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish()
}
