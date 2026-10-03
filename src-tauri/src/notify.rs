//! Desktop notifications through `notify-send` (libnotify), so they land in the system's own
//! notification center and stay there after the banner fades.

use std::process::{Command, Stdio};
use std::thread;

// The launcher and icon the desktop entry installs; GNOME files the notification under the app.
const DESKTOP_ENTRY: &str = "agent-of-empires";
// libnotify's name for a click on the notification body (no button is drawn for it).
const CLICK_ACTION: &str = "default";

/// Shows a notification and calls `on_click` when it is clicked. An action makes notify-send wait
/// until the notification is clicked or dismissed, so it waits on its own thread.
pub fn send(title: &str, body: &str, on_click: impl FnOnce() + Send + 'static) {
    let (title, body) = (title.to_string(), body.to_string());
    thread::spawn(move || {
        let output = Command::new("notify-send")
            .arg(format!("--app-name={}", crate::APP_NAME))
            .arg(format!("--icon={DESKTOP_ENTRY}"))
            .arg(format!("--hint=string:desktop-entry:{DESKTOP_ENTRY}"))
            .arg(format!("--action={CLICK_ACTION}=Abrir o mapa"))
            .arg("--")
            .arg(&title)
            .arg(&body)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        match output {
            Ok(output) if String::from_utf8_lossy(&output.stdout).trim() == CLICK_ACTION => on_click(),
            Ok(_) => {}
            Err(err) => eprintln!("[notify] notify-send unavailable: {err}"),
        }
    });
}
