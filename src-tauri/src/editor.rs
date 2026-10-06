//! Brings a session's editor tab to the front.
//!
//! The Claude Code extension handles `<scheme>://anthropic.claude-code/open?session=<id>` by
//! revealing the tab that already hosts that session. The URL must reach the right window, or the
//! other window would resume the session in a second process; Cursor routes by `windowId`, which
//! the extension host exposes to its children as `VSCODE_PROCESS_TITLE="... [<windowId>-<hostId>]"`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

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
// Listing a window's watches costs the kernel ~25 ms, so a process is read when it shows up and
// then only this often (a folder added to its workspace).
const WATCHES_REREAD: Duration = Duration::from_secs(60);
// A new window's watcher is still walking its folder: until it is this old, read it on every call.
const WATCHER_SETTLE_SECS: f64 = 30.0;
// /proc counts process start times in these ticks on every Linux architecture.
const USER_HZ: f64 = 100.0;

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
// Each editor's settings folder, the `--user-data-dir` every process of its windows carries.
const EDITOR_DATA_DIRS: [(&str, &str); 3] = [("/Cursor", "Cursor"), ("/Code", "VS Code"), ("/Code - Insiders", "VS Code Insiders")];

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

/// The folders, among `folders`, that an editor window has open, with that editor's name. Every
/// window runs a file watcher (an Electron utility process) with an inotify watch on each folder of
/// its workspace and on everything under it, so a folder is open when a watcher watches it but not
/// its parent: a worktree inside an open repository is not a window of its own.
pub fn open_folders(folders: &[String]) -> HashMap<String, &'static str> {
    let mut watchers = WATCHERS.get_or_init(Mutex::default).lock().unwrap_or_else(PoisonError::into_inner);
    refresh_watchers(&mut watchers);
    folders
        .iter()
        .filter_map(|folder| {
            let path = Path::new(folder);
            let inode = inode_of(path)?;
            let parent = path.parent().and_then(inode_of);
            let watcher = watchers.values().find(|w| w.inodes.contains(&inode) && !parent.is_some_and(|p| w.inodes.contains(&p)))?;
            Some((folder.clone(), watcher.editor))
        })
        .collect()
}

/// A process of an editor window and what it watches.
struct Watcher {
    started: u64,
    editor: &'static str,
    inodes: HashSet<u64>,
    read_at: Instant,
    is_settled: bool,
}

static WATCHERS: OnceLock<Mutex<HashMap<u32, Watcher>>> = OnceLock::new();

fn refresh_watchers(watchers: &mut HashMap<u32, Watcher>) {
    let Ok(entries) = fs::read_dir("/proc") else { return };
    let uptime = fs::read_to_string("/proc/uptime").ok().and_then(|text| text.split(' ').next()?.parse::<f64>().ok());
    let mut alive = HashSet::new();
    for pid in entries.flatten().filter_map(|entry| entry.file_name().to_str()?.parse::<u32>().ok()) {
        let Some(editor) = fs::read(format!("/proc/{pid}/cmdline")).ok().and_then(|cmdline| utility_editor(&cmdline)) else { continue };
        let Some(started) = start_time(pid) else { continue };
        alive.insert(pid);
        let is_fresh = watchers.get(&pid).is_some_and(|w| w.started == started && w.is_settled && w.read_at.elapsed() < WATCHES_REREAD);
        if !is_fresh {
            let is_settled = uptime.is_none_or(|uptime| uptime - started as f64 / USER_HZ >= WATCHER_SETTLE_SECS);
            watchers.insert(pid, Watcher { started, editor, inodes: inotify_inodes(pid), read_at: Instant::now(), is_settled });
        }
    }
    watchers.retain(|pid, _| alive.contains(pid));
}

/// Field 22 of /proc/<pid>/stat, in ticks since boot: a pid reused by another process starts at another time.
fn start_time(pid: u32) -> Option<u64> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields = stat.get(stat.rfind(')')? + 2..)?;
    fields.split(' ').nth(19)?.parse().ok()
}

/// The editor an Electron utility process works for, from its `--user-data-dir`. Chromium rewrites a
/// child's command line into one space-separated title, so the value ends at the next " --".
fn utility_editor(cmdline: &[u8]) -> Option<&'static str> {
    let cmdline = String::from_utf8_lossy(cmdline);
    if !cmdline.contains("--type=utility") {
        return None;
    }
    let dir = cmdline.split_once("--user-data-dir=")?.1;
    let dir = dir.split(" --").next()?.split('\0').next()?.trim_end_matches('/');
    EDITOR_DATA_DIRS.iter().find(|(suffix, _)| dir.ends_with(suffix)).map(|(_, name)| *name)
}

/// Inodes under watch in the process's inotify instances.
fn inotify_inodes(pid: u32) -> HashSet<u64> {
    let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else { return HashSet::new() };
    let mut inodes = HashSet::new();
    for fd in fds.flatten() {
        if !fs::read_link(fd.path()).is_ok_and(|target| target.as_os_str() == "anon_inode:inotify") {
            continue;
        }
        if let Ok(info) = fs::read(format!("/proc/{pid}/fdinfo/{}", fd.file_name().to_string_lossy())) {
            inodes.extend(watched_inodes(&info));
        }
    }
    inodes
}

/// `inotify wd:1 ino:2f3a sdev:23 mask:...` lines of an fdinfo → 0x2f3a. The device is left out: on
/// btrfs it names the filesystem, not the subvolume `stat` reports.
fn watched_inodes(fdinfo: &[u8]) -> impl Iterator<Item = u64> + '_ {
    fdinfo.split(|&b| b == b'\n').filter(|line| line.starts_with(b"inotify ")).filter_map(|line| {
        let hex = std::str::from_utf8(line).ok()?.split_once(" ino:")?.1.split(' ').next()?;
        u64::from_str_radix(hex, 16).ok()
    })
}

#[cfg(unix)]
fn inode_of(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).ok().map(|meta| meta.ino())
}

#[cfg(not(unix))]
fn inode_of(_path: &Path) -> Option<u64> {
    None
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
    fn only_editor_utility_processes_name_their_editor() {
        let cursor = b"/usr/lib/electron42/electron --type=utility --utility-sub-type=node.mojom.NodeService --user-data-dir=/home/a/.config/Cursor --standard-schemes=vscode-file";
        assert_eq!(utility_editor(cursor), Some("Cursor"));
        assert_eq!(utility_editor(b"electron\0--type=utility\0--user-data-dir=/home/a/.config/Code - Insiders\0--lang=en-US"), Some("VS Code Insiders"));
        assert_eq!(utility_editor(b"/usr/lib/slack --type=utility --user-data-dir=/home/a/.config/Slack"), None);
        // the main process watches folders of windows already closed
        assert_eq!(utility_editor(b"/usr/lib/electron42/electron /usr/share/cursor/resources/app/cursor.mjs --user-data-dir=/home/a/.config/Cursor"), None);
    }

    #[test]
    fn watched_inodes_come_from_the_inotify_lines() {
        let fdinfo = b"pos:\t0\nflags:\t02004000\nmnt_id:\t16\nino:\t1057\ninotify wd:2 ino:3ab48ac sdev:23 mask:4000fc6 ignored_mask:0\ninotify wd:1 ino:100 sdev:23 mask:3cc\n";
        assert_eq!(watched_inodes(fdinfo).collect::<Vec<_>>(), vec![0x3ab48ac, 0x100]);
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
