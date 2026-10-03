//! Brings a session's editor tab to the front.
//!
//! The Claude Code extension handles `<scheme>://anthropic.claude-code/open?session=<id>` by
//! revealing the tab that already hosts that session. The URL must reach the right window, or the
//! other window would resume the session in a second process; Cursor routes by `windowId`, which
//! the extension host exposes to its children as `VSCODE_PROCESS_TITLE="... [<windowId>-<hostId>]"`.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

// Without a window id we first focus the folder's window, since URLs go to the last active one.
const FOCUS_SETTLE: Duration = Duration::from_millis(900);
// On Wayland only GNOME Shell may raise another app's window. The "Activate Window By Title"
// extension (extensions.gnome.org) exposes that over D-Bus.
const FOCUS_BUS: &str = "org.gnome.Shell";
const FOCUS_PATH: &str = "/de/lucaswerkmeister/ActivateWindowByTitle";
const FOCUS_INTERFACE: &str = "de.lucaswerkmeister.ActivateWindowByTitle";
// A folder opened a moment ago may still be loading: wait for its window before routing the URL.
const NEW_WINDOW_WAIT: Duration = Duration::from_secs(12);
const NEW_WINDOW_POLL: Duration = Duration::from_millis(500);
const DEPLOY_EDITOR: usize = 0; // new agents always go to Cursor

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Raise {
    Raised,
    WindowNotFound,
    ShellExtensionMissing,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditorHost {
    pub name: &'static str,
    cli: &'static str,
    scheme: &'static str,
    title_app: &'static str,
    pub window_id: Option<u32>,
    workspace_label: Option<String>,
}

// (extensions dir marker in the claude binary path, display name, CLI, URL scheme, window title app name)
const EDITORS: [(&str, &str, &str, &str, &str); 3] = [
    ("/.cursor/extensions/", "Cursor", "cursor", "cursor", "Cursor"),
    ("/.vscode/extensions/", "VS Code", "code", "vscode", "Visual Studio Code"),
    ("/.vscode-insiders/extensions/", "VS Code Insiders", "code-insiders", "vscode-insiders", "Visual Studio Code - Insiders"),
];

/// Which editor window runs this Claude Code process, if any (terminal and SDK sessions: none).
pub fn locate(pid: u32) -> Option<EditorHost> {
    let cmdline = fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let exe = String::from_utf8_lossy(cmdline.split(|&b| b == 0).next()?).into_owned();
    let (_, name, cli, scheme, title_app) = EDITORS.iter().find(|(marker, ..)| exe.contains(marker))?;
    let environ = fs::read(format!("/proc/{pid}/environ")).unwrap_or_default();
    let env_var = |key: &str| {
        environ.split(|&b| b == 0).find_map(|pair| {
            pair.strip_prefix(key.as_bytes())?.strip_prefix(b"=").map(|v| String::from_utf8_lossy(v).into_owned())
        })
    };
    let window_id = env_var("VSCODE_PROCESS_TITLE").and_then(|title| parse_window_id(&title));
    let workspace_label = env_var("CURSOR_WORKSPACE_LABEL").filter(|label| !label.is_empty());
    Some(EditorHost { name, cli, scheme, title_app, window_id, workspace_label })
}

/// `extension-host (user) web-app [4-17]` → 4
fn parse_window_id(title: &str) -> Option<u32> {
    let bracket = title.trim_end().strip_suffix(']')?.rsplit_once('[')?.1;
    bracket.split_once('-')?.0.parse().ok().filter(|&id| id > 0)
}

pub fn open_session(host: &EditorHost, session_id: &str, cwd: &str) -> Result<Raise, String> {
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Id de sessão inválido".into());
    }
    let label = host
        .workspace_label
        .clone()
        .or_else(|| Path::new(cwd).file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let raise = raise_window(&label, host.title_app);
    let mut url = format!("{}://anthropic.claude-code/open?session={session_id}", host.scheme);
    match host.window_id {
        Some(window_id) => url.push_str(&format!("&windowId={window_id}")),
        None => {
            run(editor_command(host.cli).arg(cwd), host.name)?;
            thread::sleep(FOCUS_SETTLE);
        }
    }
    run(editor_command(host.cli).arg("--open-url").arg(&url), host.name)?;
    Ok(raise)
}

/// Opens `project` in Cursor with a new Claude tab holding `task`. The extension only prefills the
/// prompt (external links cannot make Claude run anything), so the user confirms it with Enter.
pub fn deploy_agent(project: &Path, task: &str, window_id: Option<u32>) -> Result<Raise, String> {
    open_extension_url(project, &format!("prompt={}", percent_encode(task)), window_id)
}

/// Reopens a session that is no longer running (e.g. moved out of the office) in a Cursor tab.
pub fn resume_in_cursor(project: &Path, session_id: &str, window_id: Option<u32>) -> Result<Raise, String> {
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Id de sessão inválido".into());
    }
    open_extension_url(project, &format!("session={session_id}"), window_id)
}

/// Brings `project`'s Cursor window to the front, opening the folder if needed. Without a window id
/// the URL goes to the last active window, so a window we cannot find is an error, not a guess.
pub fn focus_project_window(project: &Path, window_id: Option<u32>) -> Result<Raise, String> {
    let (_, name, cli, _, title_app) = EDITORS[DEPLOY_EDITOR];
    let folder = project.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if window_id.is_some() {
        return Ok(raise_window(&folder, title_app));
    }
    // Cursor 3 hands a plain `cursor <folder>` to the Agents window when that was the last one used.
    run(editor_command(cli).arg("--classic").arg(project), name)?;
    match wait_for_window(&folder, title_app) {
        Raise::WindowNotFound => Err(format!("Não achei a janela do {name} com {folder}: abra a pasta no editor (não na janela Agents) e tente de novo")),
        raise => Ok(raise),
    }
}

fn open_extension_url(project: &Path, query: &str, window_id: Option<u32>) -> Result<Raise, String> {
    let (_, name, cli, scheme, _) = EDITORS[DEPLOY_EDITOR];
    let mut url = format!("{scheme}://anthropic.claude-code/open?{query}");
    if let Some(id) = window_id {
        url.push_str(&format!("&windowId={id}"));
    }
    let raise = focus_project_window(project, window_id)?;
    run(editor_command(cli).arg("--open-url").arg(&url), name)?;
    Ok(raise)
}

fn wait_for_window(folder: &str, title_app: &str) -> Raise {
    let deadline = std::time::Instant::now() + NEW_WINDOW_WAIT;
    loop {
        match raise_window(folder, title_app) {
            Raise::WindowNotFound if std::time::Instant::now() < deadline => thread::sleep(NEW_WINDOW_POLL),
            Raise::ShellExtensionMissing => {
                thread::sleep(FOCUS_SETTLE);
                return Raise::ShellExtensionMissing;
            }
            other => return other,
        }
    }
}

// Titles are "<tab> - <folder> - Cursor", or just "<folder> - Cursor" with no tab open. Matching the
// whole segment keeps "app" from grabbing the "web-app" window.
fn raise_window(folder: &str, title_app: &str) -> Raise {
    let bare_title = format!("{folder} - {title_app}");
    let suffix = format!(" - {bare_title}");
    let attempts = [("activateByTitle", bare_title.as_str()), ("activateBySuffix", suffix.as_str())];
    let mut raise = Raise::WindowNotFound;
    for (method, argument) in attempts {
        let output = Command::new("gdbus")
            .args(["call", "--session", "--timeout", "2", "--dest", FOCUS_BUS, "--object-path", FOCUS_PATH])
            .args(["--method", &format!("{FOCUS_INTERFACE}.{method}"), argument])
            .stdin(Stdio::null())
            .output();
        match output {
            Ok(out) if out.status.success() && String::from_utf8_lossy(&out.stdout).contains("true") => return Raise::Raised,
            Ok(out) if out.status.success() => raise = Raise::WindowNotFound,
            _ => return Raise::ShellExtensionMissing,
        }
    }
    raise
}

fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn editor_command(cli: &str) -> Command {
    let mut command = Command::new(cli);
    // Started from an editor terminal we inherit ELECTRON_RUN_AS_NODE and VSCODE_*: with them the
    // CLI runs as plain Node or talks to the wrong instance.
    for (key, _) in std::env::vars_os() {
        let key_text = key.to_string_lossy();
        if key_text == "ELECTRON_RUN_AS_NODE" || key_text.starts_with("VSCODE_") {
            command.env_remove(&key);
        }
    }
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command
}

fn run(command: &mut Command, editor: &str) -> Result<(), String> {
    match command.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("O {editor} recusou abrir a sessão ({status})")),
        Err(err) => Err(format!("Não consegui chamar o {editor}: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_id_comes_from_extension_host_title() {
        assert_eq!(parse_window_id("extension-host (user) web-app [4-17]"), Some(4));
        assert_eq!(parse_window_id("extension-host (user) my [project] [12-3]\n"), Some(12));
        assert_eq!(parse_window_id("extension-host (user) sem id"), None);
        assert_eq!(parse_window_id("extension-host [0-1]"), None);
    }

    #[test]
    fn task_text_cannot_break_out_of_the_prompt_parameter() {
        assert_eq!(percent_encode("revisar & publicar?windowId=9"), "revisar%20%26%20publicar%3FwindowId%3D9");
        assert_eq!(percent_encode("ação"), "a%C3%A7%C3%A3o");
    }

    #[test]
    fn session_ids_that_could_inject_query_params_are_rejected() {
        let host = EditorHost { name: "Cursor", cli: "false", scheme: "cursor", title_app: "Cursor", window_id: Some(1), workspace_label: None };
        assert!(open_session(&host, "abc&windowId=9", "/tmp").is_err());
        assert!(open_session(&host, "", "/tmp").is_err());
    }
}
