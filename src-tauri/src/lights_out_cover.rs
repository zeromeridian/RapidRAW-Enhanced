//! Lights Out beyond the main window. Borderless cover windows darken the rest of every screen in step with the
//! in-app layer (`LightsOutVeil`), and Lights Out turns off once the main window loses focus, for example when the
//! user switches to another application.

use serde::Deserialize;
use tauri::AppHandle;

/// The appearance the cover windows fade to. Lights Out is off when no cover is requested.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LightsOutCover {
    color: String,
    opacity: f64,
    blocks_clicks: bool,
}

impl LightsOutCover {
    /// The colour is written into a script, so only `#rrggbb` is accepted.
    fn validated(self) -> Result<Self, String> {
        let is_hex_color = self.color.len() == 7
            && self.color.starts_with('#')
            && self
                .color
                .bytes()
                .skip(1)
                .all(|byte| byte.is_ascii_hexdigit());
        if !is_hex_color {
            return Err(format!("Invalid Lights Out color: {}", self.color));
        }
        if !self.opacity.is_finite() {
            return Err(format!("Invalid Lights Out opacity: {}", self.opacity));
        }
        Ok(Self {
            opacity: self.opacity.clamp(0.0, 1.0),
            ..self
        })
    }
}

#[tauri::command]
pub async fn set_lights_out_cover(
    app_handle: AppHandle,
    cover: Option<LightsOutCover>,
) -> Result<(), String> {
    let cover = cover.map(LightsOutCover::validated).transpose()?;

    #[cfg(not(target_os = "android"))]
    desktop::set_cover(&app_handle, cover).await;

    #[cfg(target_os = "android")]
    let _ = (app_handle, cover);

    Ok(())
}

#[cfg(not(target_os = "android"))]
pub use desktop::install;

#[cfg(not(target_os = "android"))]
mod desktop {
    use std::sync::Mutex;
    use std::time::Duration;

    use tauri::webview::PageLoadEvent;
    use tauri::{
        AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
        WebviewWindowBuilder, WindowEvent,
    };
    use tokio::sync::Mutex as TokioMutex;

    use super::LightsOutCover;
    use crate::window_customizer::MAIN_WINDOW_LABEL;
    #[cfg(target_os = "macos")]
    use crate::window_customizer::set_macos_window_rounding;

    const COVER_PAGE: &str = "lights-out-cover.html";
    const COVER_LABEL_PREFIX: &str = "lights-out-cover-";
    /// Matches `LIGHTS_OUT_FADE_MS` in `src/utils/lightsOut.ts` and the transition in the cover page.
    const FADE_DURATION: Duration = Duration::from_millis(300);
    /// Focus that returns to the main window within this time does not turn Lights Out off.
    const FOCUS_LOSS_GRACE: Duration = Duration::from_millis(150);
    const DEACTIVATED_EVENT: &str = "lights-out-deactivated";

    #[derive(Default)]
    struct LightsOutCoverState {
        /// The requested appearance. Never held across window calls, so main-thread handlers can read it.
        cover: Mutex<Option<LightsOutCover>>,
        /// Holding this lock serialises creating, placing, and removing the cover windows.
        covers: TokioMutex<Covers>,
    }

    impl LightsOutCoverState {
        fn cover(&self) -> Option<LightsOutCover> {
            self.cover.lock().unwrap().clone()
        }
    }

    #[derive(Default)]
    struct Covers {
        windows: Vec<WebviewWindow>,
        /// The appearance every window in `windows` has been given.
        applied: Option<LightsOutCover>,
        next_label: u64,
    }

    /// A rectangle in the desktop coordinate space windows are placed in.
    #[derive(Clone, Copy, Debug, PartialEq)]
    struct Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    impl Rect {
        fn right(&self) -> f64 {
            self.x + self.width
        }

        fn bottom(&self) -> f64 {
            self.y + self.height
        }

        fn intersection(&self, other: &Rect) -> Option<Rect> {
            let x = self.x.max(other.x);
            let y = self.y.max(other.y);
            let right = self.right().min(other.right());
            let bottom = self.bottom().min(other.bottom());
            (right > x && bottom > y).then_some(Rect {
                x,
                y,
                width: right - x,
                height: bottom - y,
            })
        }
    }

    /// Covers every screen except the window: a whole screen the window is not on, otherwise up to four bands that
    /// frame the part of the window on that screen.
    fn cover_rects(screens: &[Rect], window: Rect) -> Vec<Rect> {
        screens
            .iter()
            .flat_map(|screen| {
                let Some(hole) = screen.intersection(&window) else {
                    return vec![*screen];
                };
                [
                    Rect {
                        height: hole.y - screen.y,
                        ..*screen
                    },
                    Rect {
                        y: hole.bottom(),
                        height: screen.bottom() - hole.bottom(),
                        ..*screen
                    },
                    Rect {
                        x: screen.x,
                        width: hole.x - screen.x,
                        ..hole
                    },
                    Rect {
                        x: hole.right(),
                        width: screen.right() - hole.right(),
                        ..hole
                    },
                ]
                .into_iter()
                .filter(|band| band.width >= 1.0 && band.height >= 1.0)
                .collect()
            })
            .collect()
    }

    /// macOS places windows in points, which stay consistent across screens with different scale factors.
    #[cfg(target_os = "macos")]
    fn screen_rect(
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
        scale_factor: f64,
    ) -> Rect {
        let position = position.to_logical::<f64>(scale_factor);
        let size = size.to_logical::<f64>(scale_factor);
        Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    }

    /// Windows and Linux place windows in one physical-pixel desktop space.
    #[cfg(not(target_os = "macos"))]
    fn screen_rect(
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
        _scale_factor: f64,
    ) -> Rect {
        Rect {
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(size.width),
            height: f64::from(size.height),
        }
    }

    #[cfg(target_os = "macos")]
    fn place(window: &WebviewWindow, rect: Rect) -> tauri::Result<()> {
        window.set_size(tauri::LogicalSize::new(rect.width, rect.height))?;
        window.set_position(tauri::LogicalPosition::new(rect.x, rect.y))
    }

    #[cfg(not(target_os = "macos"))]
    fn place(window: &WebviewWindow, rect: Rect) -> tauri::Result<()> {
        window.set_size(PhysicalSize::new(
            rect.width.round() as u32,
            rect.height.round() as u32,
        ))?;
        window.set_position(PhysicalPosition::new(
            rect.x.round() as i32,
            rect.y.round() as i32,
        ))
    }

    /// Wayland does not let applications place windows, so only the in-app layer dims there.
    #[cfg(target_os = "linux")]
    fn covers_supported() -> bool {
        match std::env::var("GDK_BACKEND") {
            Ok(backend) if backend.starts_with("x11") => true,
            Ok(backend) if backend.starts_with("wayland") => false,
            _ => std::env::var_os("WAYLAND_DISPLAY").is_none(),
        }
    }

    #[cfg(not(target_os = "linux"))]
    fn covers_supported() -> bool {
        true
    }

    fn target_rects(app: &AppHandle) -> Vec<Rect> {
        if !covers_supported() {
            return Vec::new();
        }
        let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return Vec::new();
        };
        if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(true) {
            return Vec::new();
        }
        let (Ok(position), Ok(size), Ok(scale_factor)) = (
            main.outer_position(),
            main.outer_size(),
            main.scale_factor(),
        ) else {
            return Vec::new();
        };
        let screens: Vec<Rect> = main
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|monitor| {
                screen_rect(*monitor.position(), *monitor.size(), monitor.scale_factor())
            })
            .collect();
        cover_rects(&screens, screen_rect(position, size, scale_factor))
    }

    fn appearance_script(cover: Option<&LightsOutCover>) -> String {
        let style = match cover {
            Some(cover) => format!(
                "s.backgroundColor='{}';s.opacity='{}';",
                cover.color, cover.opacity
            ),
            None => "s.opacity='0';".to_owned(),
        };
        // Waiting a frame lets a page that has just loaded fade in from transparent.
        format!(
            "requestAnimationFrame(()=>{{const s=document.body&&document.body.style;if(s){{{style}}}}});"
        )
    }

    fn apply(window: &WebviewWindow, cover: Option<&LightsOutCover>) {
        let blocks_clicks = cover.is_some_and(|cover| cover.blocks_clicks);
        if let Err(error) = window.set_ignore_cursor_events(!blocks_clicks) {
            log::warn!("Failed to update Lights Out cover click handling: {error}");
        }
        if let Err(error) = window.eval(appearance_script(cover)) {
            log::warn!("Failed to update Lights Out cover appearance: {error}");
        }
    }

    /// `NSScreenSaverWindowLevel`: above the menu bar, the Dock, and notification banners.
    #[cfg(target_os = "macos")]
    const LIGHTS_OUT_WINDOW_LEVEL: isize = 1000;
    /// `NSNormalWindowLevel`.
    #[cfg(target_os = "macos")]
    const NORMAL_WINDOW_LEVEL: isize = 0;

    /// Puts the cover above the menu bar and the Dock, and keeps it out of Mission Control and window cycling.
    #[cfg(target_os = "macos")]
    fn raise_above_system_ui(window: &WebviewWindow) {
        use objc::{msg_send, sel, sel_impl};

        /// `NSWindowCollectionBehaviorTransient | IgnoresCycle | FullScreenAuxiliary`.
        const COLLECTION_BEHAVIOR: usize = (1 << 3) | (1 << 6) | (1 << 8);

        let cover = window.clone();
        let result = window.run_on_main_thread(move || {
            let Ok(ns_window) = cover.ns_window() else {
                return;
            };
            let ns_window = ns_window.cast::<objc::runtime::Object>();
            unsafe {
                let () = msg_send![ns_window, setLevel: LIGHTS_OUT_WINDOW_LEVEL];
                let () = msg_send![ns_window, setCollectionBehavior: COLLECTION_BEHAVIOR];
            }
        });
        if let Err(error) = result {
            log::warn!("Failed to raise Lights Out cover: {error}");
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn raise_above_system_ui(_window: &WebviewWindow) {}

    /// While Lights Out is on, the main window joins the covers' level so notifications cannot appear over it, and
    /// drops its rounded corners and shadow, whose rim would otherwise stay lit between the window and the covers.
    #[cfg(target_os = "macos")]
    fn set_main_window_lights_out(app: &AppHandle, active: bool) {
        use objc::{msg_send, sel, sel_impl};

        let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };
        let result = main.with_webview(move |webview| unsafe {
            let ns_view = webview.inner().cast::<objc::runtime::Object>();
            set_macos_window_rounding(ns_view, !active);
            let ns_window: *mut objc::runtime::Object = msg_send![ns_view, window];
            if !ns_window.is_null() {
                let level = if active {
                    LIGHTS_OUT_WINDOW_LEVEL
                } else {
                    NORMAL_WINDOW_LEVEL
                };
                let () = msg_send![ns_window, setLevel: level];
            }
        });
        if let Err(error) = result {
            log::warn!("Failed to update the main window for Lights Out: {error}");
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn set_main_window_lights_out(_app: &AppHandle, _active: bool) {}

    fn create_cover(app: &AppHandle, label_index: u64) -> tauri::Result<WebviewWindow> {
        let window = WebviewWindowBuilder::new(
            app,
            format!("{COVER_LABEL_PREFIX}{label_index}"),
            WebviewUrl::App(COVER_PAGE.into()),
        )
        .title("Lights Out")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let cover = window.state::<LightsOutCoverState>().cover();
                if let Err(error) = window.eval(appearance_script(cover.as_ref())) {
                    log::warn!("Failed to show Lights Out cover: {error}");
                }
            }
        })
        .build()?;
        raise_above_system_ui(&window);
        window.show()?;
        Ok(window)
    }

    /// Places one cover window on each rectangle around the main window and gives them the requested appearance.
    /// When Lights Out is off, the existing covers fade out but stay in place until `remove_faded_covers`.
    async fn sync_covers(app: &AppHandle) {
        let state = app.state::<LightsOutCoverState>();
        let mut covers = state.covers.lock().await;
        let cover = state.cover();
        let rects = if cover.is_some() {
            target_rects(app)
        } else {
            Vec::new()
        };

        if cover != covers.applied {
            if cover.is_some() != covers.applied.is_some() {
                set_main_window_lights_out(app, cover.is_some());
            }
            for window in &covers.windows {
                apply(window, cover.as_ref());
            }
            covers.applied = cover.clone();
        }
        let Some(cover) = cover else {
            return;
        };

        while covers.windows.len() > rects.len() {
            if let Some(window) = covers.windows.pop() {
                let _ = window.destroy();
            }
        }
        for (index, rect) in rects.into_iter().enumerate() {
            if index == covers.windows.len() {
                let label_index = covers.next_label;
                covers.next_label += 1;
                match create_cover(app, label_index) {
                    Ok(window) => {
                        // The page applies the appearance once it has loaded.
                        let _ = window.set_ignore_cursor_events(!cover.blocks_clicks);
                        covers.windows.push(window);
                    }
                    Err(error) => {
                        log::warn!("Failed to create Lights Out cover: {error}");
                        return;
                    }
                }
            }
            if let Err(error) = place(&covers.windows[index], rect) {
                log::warn!("Failed to place Lights Out cover: {error}");
            }
        }
    }

    async fn remove_faded_covers(app: &AppHandle) {
        tokio::time::sleep(FADE_DURATION).await;
        let state = app.state::<LightsOutCoverState>();
        let mut covers = state.covers.lock().await;
        if state.cover().is_some() {
            return;
        }
        for window in covers.windows.drain(..) {
            let _ = window.destroy();
        }
    }

    pub(super) async fn set_cover(app: &AppHandle, cover: Option<LightsOutCover>) {
        let is_off = cover.is_none();
        *app.state::<LightsOutCoverState>().cover.lock().unwrap() = cover;
        sync_covers(app).await;
        if is_off {
            remove_faded_covers(app).await;
        }
    }

    fn turn_off_unless_refocused(app: &AppHandle) {
        let is_focused = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .is_some_and(|main| main.is_focused().unwrap_or(false));
        if !is_focused && app.state::<LightsOutCoverState>().cover().is_some() {
            let _ = app.emit_to(MAIN_WINDOW_LABEL, DEACTIVATED_EVENT, ());
        }
    }

    /// Lets the covers follow the main window, and turns Lights Out off when the main window loses focus.
    pub fn install(main_window: &WebviewWindow) {
        let app = main_window.app_handle().clone();
        app.manage(LightsOutCoverState::default());
        main_window.on_window_event(move |event| {
            let is_active = app.state::<LightsOutCoverState>().cover().is_some();
            match event {
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
                    if is_active =>
                {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { sync_covers(&app).await });
                }
                WindowEvent::Focused(false) if is_active => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(FOCUS_LOSS_GRACE).await;
                        turn_off_unless_refocused(&app);
                    });
                }
                _ => {}
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
            Rect {
                x,
                y,
                width,
                height,
            }
        }

        #[test]
        fn frames_the_window_on_its_screen() {
            let screen = rect(0.0, 0.0, 1000.0, 800.0);
            let window = rect(100.0, 50.0, 600.0, 400.0);
            assert_eq!(
                cover_rects(&[screen], window),
                vec![
                    rect(0.0, 0.0, 1000.0, 50.0),
                    rect(0.0, 450.0, 1000.0, 350.0),
                    rect(0.0, 50.0, 100.0, 400.0),
                    rect(700.0, 50.0, 300.0, 400.0),
                ]
            );
        }

        #[test]
        fn covers_other_screens_whole_and_skips_empty_bands() {
            let left = rect(-1200.0, 0.0, 1200.0, 900.0);
            let main = rect(0.0, 0.0, 1000.0, 800.0);
            let window = rect(0.0, 0.0, 1000.0, 760.0);
            assert_eq!(
                cover_rects(&[left, main], window),
                vec![left, rect(0.0, 760.0, 1000.0, 40.0)]
            );
        }

        #[test]
        fn frames_a_window_spanning_two_screens_on_both() {
            let left = rect(0.0, 0.0, 1000.0, 800.0);
            let right = rect(1000.0, 0.0, 1000.0, 800.0);
            let window = rect(800.0, 0.0, 400.0, 800.0);
            assert_eq!(
                cover_rects(&[left, right], window),
                vec![
                    rect(0.0, 0.0, 800.0, 800.0),
                    rect(1200.0, 0.0, 800.0, 800.0)
                ]
            );
        }

        #[test]
        fn accepts_only_hex_colors() {
            let cover = |color: &str, opacity: f64| LightsOutCover {
                color: color.to_owned(),
                opacity,
                blocks_clicks: false,
            };
            assert_eq!(
                cover("#1a2B3c", 1.5).validated().map(|cover| cover.opacity),
                Ok(1.0)
            );
            assert!(cover("#1a2b3", 0.5).validated().is_err());
            assert!(cover("red';alert(1);'", 0.5).validated().is_err());
            assert!(cover("#000000", f64::NAN).validated().is_err());
        }
    }
}
