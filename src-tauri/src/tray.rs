/// System tray / menu bar setup for ClipStack.
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, Runtime,
};

const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";

/// Build and register the system tray icon with its context menu.
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, MENU_SHOW, "Open ClipStack", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &sep, &quit_item])?;
    let icon = load_tray_icon(app);

    // _tray must be kept alive for the duration of the app.
    // Tauri v2 manages this internally when the tray is built via the app handle.
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("ClipStack")
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => toggle_window(app),
            MENU_QUIT => {
                log::info!("Quit requested via tray menu.");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Show the main window (positioned near the cursor) or hide it if already visible.
pub fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_near_cursor(&window);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// Position the overlay window near the current cursor position.
/// Tries to appear above the cursor; falls back to top-right if near a screen edge.
fn position_near_cursor<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let cursor = match window.cursor_position() {
        Ok(pos) => pos,
        Err(_) => return position_top_right(window),
    };

    let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
        width: 380,
        height: 520,
    });

    // Find the monitor that contains the cursor.
    if let Ok(monitors) = window.available_monitors() {
        for monitor in &monitors {
            let mpos = monitor.position();
            let msize = monitor.size();
            let right = mpos.x + msize.width as i32;
            let bottom = mpos.y + msize.height as i32;

            if cursor.x >= mpos.x as f64
                && cursor.x < right as f64
                && cursor.y >= mpos.y as f64
                && cursor.y < bottom as f64
            {
                // Center horizontally on cursor; place above cursor with a gap.
                let x = (cursor.x as i32 - win_size.width as i32 / 2)
                    .max(mpos.x + 8)
                    .min(right - win_size.width as i32 - 8);

                let y_above = cursor.y as i32 - win_size.height as i32 - 12;
                let y = if y_above >= mpos.y + 8 {
                    y_above
                } else {
                    // Not enough room above — place below cursor instead.
                    (cursor.y as i32 + 24).min(bottom - win_size.height as i32 - 8)
                };

                let _ = window.set_position(PhysicalPosition { x, y });
                return;
            }
        }
    }

    position_top_right(window);
}

/// Fallback: place near top-right of the primary monitor (below the menu bar / taskbar).
fn position_top_right<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let mpos = monitor.position();
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 380,
            height: 520,
        });
        let x = mpos.x + size.width as i32 - win_size.width as i32 - 16;
        let y = mpos.y + 48;
        let _ = window.set_position(PhysicalPosition { x, y });
    }
}

fn load_tray_icon<R: Runtime>(app: &AppHandle<R>) -> Image<'static> {
    if let Some(icon) = app.default_window_icon() {
        return Image::new_owned(icon.rgba().to_vec(), icon.width(), icon.height());
    }
    // 1×1 transparent PNG fallback.
    Image::new_owned(
        vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
            0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
            0, 0, 0, 11, 73, 68, 65, 84, 8, 215, 99, 248, 15, 0, 0, 1, 1, 0, 37,
            24, 217, 115, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ],
        1,
        1,
    )
}
