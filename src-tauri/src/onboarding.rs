//! First run: what this machine has for the app, where its repositories live, and the opt-in
//! integrations (approvals hook, plan limits, autostart). The choices live in <config dir>/config.json:
//! localStorage is too easy to lose for them.

use crate::history::first_cwd;
use crate::projects::{self, claude_config_dir, claude_projects_dir};
use crate::terminal::{detected_terminal, find_executable};
use crate::transcript::mtime_ms;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

const CONFIG_FILE: &str = "config.json";
const HOOK_EVENT: &str = "PermissionRequest";
const HOOK_FLAG: &str = "--permission-hook";
// A little over the 60 s the app waits for an answer, as the approval module expects.
const HOOK_TIMEOUT_SECS: u64 = 75;
const SETTINGS_BACKUP_SUFFIX: &str = ".agent-of-empires.bak";
// Enough of a transcript's head to reach its first entry with a cwd.
const HEAD_BYTES: u64 = 64 * 1024;
const EDITORS: [(&str, &str); 2] = [("cursor", "Cursor"), ("code", "VS Code")];
const FOCUS_EXTENSION_PREFIX: &str = "activate-window-by-title@";

static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Called once at startup with the app's config folder.
pub fn init(config_dir: PathBuf) {
    let _ = CONFIG_PATH.set(config_dir.join(CONFIG_FILE));
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// When the first-run setup was finished or skipped; None shows it on the next start.
    pub onboarded_at: Option<i64>,
    /// Where the repositories live; None means ~/Code.
    pub projects_root: Option<String>,
    /// Fetch the plan limits from Anthropic's API, the only network call the app makes.
    pub is_usage_on: bool,
}

impl Config {
    pub fn load() -> Self {
        CONFIG_PATH
            .get()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self) -> Result<(), String> {
        let path = CONFIG_PATH.get().ok_or("Configuração ainda não carregada")?;
        let text = serde_json::to_string_pretty(self).map_err(|err| err.to_string())?;
        write_atomically(path, &text).map_err(|err| format!("Não consegui salvar a configuração: {err}"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCli {
    pub path: String,
    pub version: Option<String>,
}

/// Everything the first-run checklist shows; the copy lives in the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub claude: Option<ClaudeCli>,
    pub transcript_folders: usize,
    pub has_git: bool,
    pub has_curl: bool,
    /// The first of the players the sounds and the music use, if any.
    pub audio_player: Option<String>,
    pub editors: Vec<String>,
    pub terminal: Option<String>,
    pub desktop: Option<String>,
    /// None outside GNOME, where windows can be raised without it.
    pub has_focus_extension: Option<bool>,
    pub projects_root: Option<String>,
    pub suggested_root: Option<String>,
    pub is_hook_installed: bool,
    pub hook_preview: String,
    pub settings_path: Option<String>,
    pub is_autostart_on: bool,
    pub is_usage_on: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choices {
    pub is_usage_on: bool,
    pub is_autostart_on: bool,
    pub is_hook_on: bool,
}

#[tauri::command]
pub fn get_config() -> Config {
    Config::load()
}

#[tauri::command]
pub async fn get_setup(app: AppHandle) -> Result<Setup, String> {
    tauri::async_runtime::spawn_blocking(move || survey(&app)).await.map_err(|err| err.to_string())
}

/// Saves the projects folder and returns how many repositories it holds.
#[tauri::command]
pub async fn set_projects_root(path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = expand_home(path.trim()).ok_or("Escreva o caminho de uma pasta")?;
        if !root.is_dir() {
            return Err(format!("A pasta {} não existe", root.display()));
        }
        let mut config = Config::load();
        config.projects_root = Some(root.to_string_lossy().into_owned());
        config.save()?;
        Ok(projects::list_projects().len())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Applies the integrations chosen at first run (all off when it is skipped) and marks it done.
#[tauri::command]
pub fn finish_setup(app: AppHandle, choices: Choices) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(err) = set_permission_hook(choices.is_hook_on) {
        errors.push(err);
    }
    if let Err(err) = set_autostart(&app, choices.is_autostart_on) {
        errors.push(err);
    }
    let mut config = Config::load();
    config.is_usage_on = choices.is_usage_on;
    config.onboarded_at = Some(now_ms());
    if let Err(err) = config.save() {
        errors.push(err);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" · "))
    }
}

#[tauri::command]
pub fn set_usage_on(is_on: bool) -> Result<(), String> {
    let mut config = Config::load();
    config.is_usage_on = is_on;
    config.save()
}

fn survey(app: &AppHandle) -> Setup {
    let path_env = std::env::var_os("PATH");
    let has = |name: &str| find_executable(OsStr::new(name), path_env.as_deref()).is_some();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").ok().filter(|value| !value.is_empty());
    let is_gnome = desktop.as_deref().is_some_and(|value| value.to_uppercase().contains("GNOME"));
    let settings = settings_path();
    Setup {
        claude: claude_cli(),
        transcript_folders: claude_projects_dir().and_then(|dir| fs::read_dir(dir).ok()).map_or(0, |entries| entries.count()),
        has_git: has("git"),
        has_curl: has("curl"),
        audio_player: crate::sound::PLAYERS.iter().find(|player| has(player)).map(|player| player.to_string()),
        editors: EDITORS.iter().filter(|(cli, _)| has(cli)).map(|(_, name)| name.to_string()).collect(),
        terminal: detected_terminal(),
        has_focus_extension: is_gnome.then(|| home.as_deref().is_some_and(has_focus_extension)),
        desktop,
        projects_root: projects::projects_root().map(|root| root.to_string_lossy().into_owned()),
        suggested_root: home.as_deref().and_then(suggest_root).map(|root| root.to_string_lossy().into_owned()),
        is_hook_installed: settings.as_deref().and_then(read_settings).is_some_and(|value| has_our_hook(&value)),
        hook_preview: hook_preview(),
        settings_path: settings.map(|path| path.to_string_lossy().into_owned()),
        is_autostart_on: app.autolaunch().is_enabled().unwrap_or(false),
        is_usage_on: Config::load().is_usage_on,
    }
}

fn claude_cli() -> Option<ClaudeCli> {
    let path = crate::hosted::find_claude();
    let output = Command::new(&path).arg("--version").output().ok().filter(|output| output.status.success())?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Some(ClaudeCli { path: path.to_string_lossy().into_owned(), version: Some(version).filter(|v| !v.is_empty()) })
}

fn has_focus_extension(home: &Path) -> bool {
    [home.join(".local/share/gnome-shell/extensions"), PathBuf::from("/usr/share/gnome-shell/extensions")]
        .iter()
        .filter_map(|dir| fs::read_dir(dir).ok())
        .flatten()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(FOCUS_EXTENSION_PREFIX))
}

/// The folder right under home where most Claude Code sessions ran: where this person keeps code.
/// Falls back to ~/Code when there is no history yet.
fn suggest_root(home: &Path) -> Option<PathBuf> {
    let cwds = claude_projects_dir().map(|dir| session_cwds(&dir)).unwrap_or_default();
    pick_root(home, cwds.iter().map(PathBuf::from)).or_else(|| Some(home.join("Code")).filter(|dir| dir.is_dir()))
}

fn pick_root(home: &Path, cwds: impl Iterator<Item = PathBuf>) -> Option<PathBuf> {
    let mut counts: HashMap<PathBuf, usize> = HashMap::new();
    for cwd in cwds {
        let Ok(rest) = cwd.strip_prefix(home) else { continue };
        let Some(Component::Normal(first)) = rest.components().next() else { continue };
        if first.to_string_lossy().starts_with('.') {
            continue;
        }
        let folder = home.join(first);
        // A repository right under home is found from home itself.
        let root = if folder.join(".git").exists() { home.to_path_buf() } else { folder };
        if root.is_dir() {
            *counts.entry(root).or_default() += 1;
        }
    }
    counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0))).map(|(root, _)| root)
}

/// Where each project's newest session started.
fn session_cwds(claude_projects: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(claude_projects) else { return Vec::new() };
    entries.flatten().filter_map(|entry| newest_transcript(&entry.path())).filter_map(|path| read_head(&path)).filter_map(|head| first_cwd(&head)).collect()
}

fn newest_transcript(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|entry| Some((mtime_ms(&entry.metadata().ok()?), entry.path())))
        .max_by_key(|(mtime, _)| *mtime)
        .map(|(_, path)| path)
}

fn read_head(path: &Path) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    File::open(path).ok()?.take(HEAD_BYTES).read_to_end(&mut buf).ok()?;
    Some(buf)
}

// ---------- The PermissionRequest hook in Claude Code's settings.json ----------

fn settings_path() -> Option<PathBuf> {
    claude_config_dir().map(|dir| dir.join("settings.json"))
}

fn read_settings(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn hook_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|err| format!("Não achei o executável do app: {err}"))?;
    // Single quotes: the shell Claude Code runs hooks in takes the path literally.
    Ok(format!("'{}' {HOOK_FLAG}", exe.to_string_lossy().replace('\'', r"'\''")))
}

fn hook_preview() -> String {
    let command = hook_command().unwrap_or_else(|_| format!("agent-of-empires {HOOK_FLAG}"));
    let entry = json!({ "hooks": { HOOK_EVENT: [hook_entry(&command)] } });
    serde_json::to_string_pretty(&entry).unwrap_or_default()
}

fn hook_entry(command: &str) -> Value {
    json!({ "matcher": "*", "hooks": [{ "type": "command", "command": command, "timeout": HOOK_TIMEOUT_SECS }] })
}

fn is_our_command(command: &str) -> bool {
    command.contains("agent-of-empires") && command.trim_end().ends_with(HOOK_FLAG)
}

fn has_our_hook(settings: &Value) -> bool {
    settings["hooks"][HOOK_EVENT]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
        .any(|hook| hook["command"].as_str().is_some_and(is_our_command))
}

/// The settings with our hook removed and, when `command` is given, added back pointing at it.
/// Every other hook (and the order of every key) stays as it was.
fn with_hook(mut settings: Value, command: Option<&str>) -> Result<Value, String> {
    let root = settings.as_object_mut().ok_or("settings.json não é um objeto JSON")?;
    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" no settings.json não é um objeto")?;
    let groups = hooks.entry(HOOK_EVENT).or_insert_with(|| json!([]));
    let groups = groups.as_array_mut().ok_or("\"PermissionRequest\" no settings.json não é uma lista")?;
    for group in groups.iter_mut() {
        if let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) {
            list.retain(|hook| !hook["command"].as_str().is_some_and(is_our_command));
        }
    }
    groups.retain(|group| group.get("hooks").and_then(Value::as_array).is_none_or(|list| !list.is_empty()));
    if let Some(command) = command {
        groups.push(hook_entry(command));
    }
    if groups.is_empty() {
        hooks.remove(HOOK_EVENT);
    }
    Ok(settings)
}

/// Installs (or removes) the hook that sends permission prompts to the app's panel. The previous
/// settings.json is kept next to it; a file that does not parse is never touched.
fn set_permission_hook(is_on: bool) -> Result<(), String> {
    let path = settings_path().ok_or("Não achei a pasta do Claude Code")?;
    let original = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Não consegui ler {}: {err}", path.display())),
    };
    let current = match &original {
        Some(text) => serde_json::from_str(text).map_err(|_| format!("{} não é JSON válido: nada foi mudado", path.display()))?,
        None if !is_on => return Ok(()),
        None => json!({}),
    };
    if !is_on && !has_our_hook(&current) {
        return Ok(());
    }
    let command = if is_on { Some(hook_command()?) } else { None };
    let updated = with_hook(current.clone(), command.as_deref())?;
    if updated == current {
        return Ok(());
    }
    if let Some(text) = &original {
        let backup = PathBuf::from(format!("{}{SETTINGS_BACKUP_SUFFIX}", path.display()));
        fs::write(&backup, text).map_err(|err| format!("Não consegui fazer o backup do settings.json: {err}"))?;
    }
    let text = serde_json::to_string_pretty(&updated).map_err(|err| err.to_string())? + "\n";
    write_atomically(&path, &text).map_err(|err| format!("Não consegui gravar {}: {err}", path.display()))
}

fn set_autostart(app: &AppHandle, is_on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = match (is_on, launcher.is_enabled().unwrap_or(false)) {
        (true, _) => launcher.enable(), // rewritten even when on, so it follows the binary
        (false, true) => launcher.disable(),
        (false, false) => Ok(()),
    };
    result.map_err(|err| format!("Não consegui mudar o início automático: {err}"))
}

// ---------- Helpers ----------

fn write_atomically(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp-agent-of-empires");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

fn expand_home(path: &str) -> Option<PathBuf> {
    if path.is_empty() {
        return None;
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => Some(home?.join(rest.trim_start_matches('/'))),
        _ => Some(PathBuf::from(path)),
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: &str = "'/opt/agent-of-empires' --permission-hook";

    #[test]
    fn hook_is_added_once_and_other_hooks_stay() {
        let other = json!({ "matcher": "*", "hooks": [{ "type": "command", "command": "orca-hook", "timeout": 10 }] });
        let settings = json!({ "model": "opus", "hooks": { "Stop": [], HOOK_EVENT: [other.clone()] } });
        let installed = with_hook(settings, Some(OURS)).unwrap();
        assert!(has_our_hook(&installed));
        assert_eq!(installed["hooks"][HOOK_EVENT], json!([other, hook_entry(OURS)]));
        // Installing again (e.g. after the binary moved) replaces ours instead of adding a second one.
        let again = with_hook(installed, Some("\"/new/agent-of-empires\" --permission-hook")).unwrap();
        assert_eq!(again["hooks"][HOOK_EVENT].as_array().unwrap().len(), 2);
        // Key order is kept, so the user's file does not get reshuffled.
        assert_eq!(again.as_object().unwrap().keys().collect::<Vec<_>>(), ["model", "hooks"]);
    }

    #[test]
    fn removing_the_hook_leaves_no_empty_event_behind() {
        let installed = with_hook(json!({}), Some(OURS)).unwrap();
        let removed = with_hook(installed, None).unwrap();
        assert!(!has_our_hook(&removed));
        assert_eq!(removed, json!({ "hooks": {} }));
    }

    #[test]
    fn a_settings_file_that_is_not_an_object_is_refused() {
        assert!(with_hook(json!([1, 2]), Some(OURS)).is_err());
        assert!(with_hook(json!({ "hooks": [] }), Some(OURS)).is_err());
    }

    #[test]
    fn suggested_root_is_where_most_sessions_ran() {
        let home = std::env::temp_dir().join(format!("cpo-onboarding-{}", std::process::id()));
        for dir in ["Code/a", "Code/b", "work/c", ".claude-mem/x", "solo/.git"] {
            fs::create_dir_all(home.join(dir)).unwrap();
        }
        let cwds = ["Code/a", "Code/b/src", "work/c", ".claude-mem/x", ".claude-mem/x"].map(|dir| home.join(dir));
        assert_eq!(pick_root(&home, cwds.into_iter()), Some(home.join("Code")));
        // A repository right under home makes home itself the root.
        let solo = ["solo", "solo", "Code/a"].map(|dir| home.join(dir));
        assert_eq!(pick_root(&home, solo.into_iter()), Some(home.clone()));
        assert_eq!(pick_root(&home, [PathBuf::from("/elsewhere")].into_iter()), None);
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn tilde_expands_to_home() {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        assert_eq!(expand_home("~/Code"), Some(home.join("Code")));
        assert_eq!(expand_home("~"), Some(home));
        assert_eq!(expand_home("/srv/repos"), Some(PathBuf::from("/srv/repos")));
        assert_eq!(expand_home("~other/x"), Some(PathBuf::from("~other/x")));
        assert_eq!(expand_home(""), None);
    }
}
