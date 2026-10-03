//! Discovers live Claude Code sessions and turns their transcripts into a snapshot for the UI.
//!
//! Sources: `~/.claude/sessions/<pid>.json` (one per running process, with busy/idle status)
//! and `~/.claude/projects/<slug>/<sessionId>.jsonl` (+ `<sessionId>/subagents/agent-*.jsonl`).

use crate::transcript::{clip, describe_tool, mtime_ms, LastKind, PendingTool, Step, TranscriptState, TranscriptTracker};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// Subagent files untouched for longer than this are not even opened.
const SUBAGENT_SCAN_WINDOW_MS: i64 = 15 * 60 * 1000;
// A subagent that answered stays on screen briefly so the "done" moment is visible.
const SUBAGENT_DONE_LINGER_MS: i64 = 8 * 1000;
// No tool running and no writes for this long: the subagent died with its parent turn.
const SUBAGENT_SILENT_MS: i64 = 90 * 1000;
const PROMPT_MAX: usize = 160;
const DESCRIPTION_MAX: usize = 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub kind: &'static str,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub since: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    pub id: String,
    #[serde(rename = "type")]
    pub agent_type: String,
    pub description: Option<String>,
    pub activity: Activity,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTouch {
    /// Absolute path, so two agents editing the same file can be matched.
    pub path: String,
    /// Path relative to the session's folder, for display.
    pub rel: String,
    pub at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub pid: u32,
    pub name: String,
    pub project: String,
    /// Display only (the deploy picker counts agents per repo); commands still take session ids.
    pub cwd: String,
    pub entrypoint: String,
    /// Editor window hosting the session ("Cursor", "VS Code"...); None for terminal/SDK sessions.
    pub editor: Option<&'static str>,
    pub status: &'static str,
    pub started_at: Option<i64>,
    pub title: Option<String>,
    pub last_prompt: Option<String>,
    pub last_prompt_at: Option<i64>,
    pub last_reply: Option<String>,
    pub steps: Vec<Step>,
    /// Most recently edited first.
    pub files: Vec<FileTouch>,
    pub model: Option<String>,
    pub activity: Activity,
    pub subagents: Vec<Subagent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub generated_at: i64,
    pub agents: Vec<Agent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    pid: u32,
    session_id: String,
    #[serde(default)]
    cwd: String,
    name: Option<String>,
    entrypoint: Option<String>,
    status: Option<String>,
    proc_start: Option<Value>,
    started_at: Option<f64>,
    updated_at: Option<f64>,
    status_updated_at: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubagentMeta {
    agent_type: Option<String>,
    description: Option<String>,
}

pub struct Collector {
    sessions_dir: PathBuf,
    projects_dir: PathBuf,
    trackers: HashMap<PathBuf, TranscriptTracker>,
    transcript_paths: HashMap<String, PathBuf>,
    subagent_meta: HashMap<PathBuf, SubagentMeta>,
}

fn claude_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
        .unwrap_or_else(|| PathBuf::from(".claude"))
}

/// Sends SIGTERM to the live process registered for `session_id`; Claude Code saves the
/// transcript and exits on it. Only processes listed in the sessions dir, with a matching start
/// time, are ever signalled.
pub fn terminate_session(session_id: &str) -> Result<usize, String> {
    terminate_session_in(&claude_dir().join("sessions"), session_id)
}

fn terminate_session_in(sessions_dir: &Path, session_id: &str) -> Result<usize, String> {
    let mut signalled = 0;
    for path in list_dir(sessions_dir) {
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(session) = read_json::<SessionFile>(&path) else { continue };
        if session.session_id != session_id || !is_process_alive(session.pid, session.proc_start.as_ref()) {
            continue;
        }
        send_sigterm(session.pid).map_err(|err| format!("Não consegui encerrar o processo {}: {err}", session.pid))?;
        signalled += 1;
    }
    if signalled == 0 {
        return Err("Essa sessão já não está rodando".into());
    }
    Ok(signalled)
}

#[cfg(unix)]
pub(crate) fn send_sigterm(pid: u32) -> std::io::Result<()> {
    // SAFETY: plain kill(2) on a pid just verified to be a live Claude Code session.
    if unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
pub(crate) fn send_sigterm(_pid: u32) -> std::io::Result<()> {
    Err(std::io::Error::other("encerrar sessão só é suportado em Unix"))
}

impl Collector {
    pub fn new() -> Self {
        let claude_dir = claude_dir();
        Self {
            sessions_dir: claude_dir.join("sessions"),
            projects_dir: claude_dir.join("projects"),
            trackers: HashMap::new(),
            transcript_paths: HashMap::new(),
            subagent_meta: HashMap::new(),
        }
    }

    pub fn snapshot(&mut self) -> Snapshot {
        let now = now_ms();
        let mut seen = HashSet::new();
        let mut agents = Vec::new();

        for session in self.live_sessions() {
            let Some(path) = self.find_transcript(&session) else {
                agents.push(to_agent(&session, None, now));
                continue;
            };
            seen.insert(path.clone());
            let mut agent = to_agent(&session, Some(self.tracker(&path).refresh()), now);
            agent.subagents = self.collect_subagents(&path, &session.session_id, now, &mut seen);
            agents.push(agent);
        }

        self.trackers.retain(|path, _| seen.contains(path));
        agents.sort_by_key(|agent| agent.started_at.unwrap_or(0));
        Snapshot { generated_at: now, agents }
    }

    fn tracker(&mut self, path: &Path) -> &mut TranscriptTracker {
        self.trackers.entry(path.to_path_buf()).or_insert_with(|| TranscriptTracker::new(path.to_path_buf()))
    }

    // Several PIDs can share a sessionId after a resume; keep the most recently updated live one.
    fn live_sessions(&self) -> Vec<SessionFile> {
        let mut by_id: HashMap<String, SessionFile> = HashMap::new();
        for path in list_dir(&self.sessions_dir) {
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(session) = read_json::<SessionFile>(&path) else { continue };
            if !is_process_alive(session.pid, session.proc_start.as_ref()) {
                continue;
            }
            let is_newer = by_id
                .get(&session.session_id)
                .map_or(true, |known| session.updated_at.unwrap_or(0.0) > known.updated_at.unwrap_or(0.0));
            if is_newer {
                by_id.insert(session.session_id.clone(), session);
            }
        }
        by_id.into_values().collect()
    }

    fn find_transcript(&mut self, session: &SessionFile) -> Option<PathBuf> {
        if let Some(cached) = self.transcript_paths.get(&session.session_id) {
            if cached.exists() {
                return Some(cached.clone());
            }
        }
        let file_name = format!("{}.jsonl", session.session_id);
        let direct = self.projects_dir.join(project_slug(&session.cwd)).join(&file_name);
        // Long cwds get a hashed folder name, so fall back to scanning every project folder.
        let found = if direct.exists() {
            Some(direct)
        } else {
            list_dir(&self.projects_dir).into_iter().map(|dir| dir.join(&file_name)).find(|p| p.exists())
        }?;
        self.transcript_paths.insert(session.session_id.clone(), found.clone());
        Some(found)
    }

    fn collect_subagents(&mut self, transcript: &Path, session_id: &str, now: i64, seen: &mut HashSet<PathBuf>) -> Vec<Subagent> {
        let dir = transcript.with_extension("").join("subagents");
        let mut subagents = Vec::new();
        for path in list_dir(&dir) {
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(meta) = fs::metadata(&path) else { continue };
            if now - mtime_ms(&meta) > SUBAGENT_SCAN_WINDOW_MS {
                continue;
            }
            seen.insert(path.clone());

            let state = self.tracker(&path).refresh();
            let pending = state.latest_pending_tool(now).cloned();
            let is_done = pending.is_none() && state.last_kind == Some(LastKind::Text);
            let quiet_for = now - state.mtime_ms;
            if (is_done && quiet_for > SUBAGENT_DONE_LINGER_MS) || (!is_done && pending.is_none() && quiet_for > SUBAGENT_SILENT_MS) {
                continue;
            }
            let activity = if is_done {
                Activity { kind: "done", label: "Terminou".into(), tool: None, since: state.last_event_at }
            } else {
                activity_from_state(state, pending.as_ref())
            };

            let meta_path = path.with_extension("meta.json");
            let meta = self.subagent_meta.entry(meta_path.clone()).or_insert_with(|| read_json(&meta_path).unwrap_or_default());
            let file_stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            subagents.push(Subagent {
                id: format!("{session_id}:{file_stem}"),
                agent_type: meta.agent_type.clone().unwrap_or_else(|| "subagent".into()),
                description: meta.description.as_deref().map(|d| clip(d, DESCRIPTION_MAX)),
                activity,
            });
        }
        subagents
    }
}

fn activity_from_state(state: &TranscriptState, pending: Option<&PendingTool>) -> Activity {
    if let Some(tool) = pending {
        return Activity {
            kind: crate::transcript::tool_kind(&tool.name),
            label: describe_tool(&tool.name, &tool.input),
            tool: Some(tool.name.clone()),
            since: tool.at,
        };
    }
    if state.last_kind == Some(LastKind::Text) {
        return Activity { kind: "writing", label: "Escrevendo resposta".into(), tool: None, since: state.last_event_at };
    }
    Activity { kind: "thinking", label: "Pensando".into(), tool: None, since: state.last_event_at }
}

fn to_agent(session: &SessionFile, state: Option<&TranscriptState>, now: i64) -> Agent {
    // "waiting" = a permission prompt is open: the turn is live but blocked on the user.
    let is_waiting = session.status.as_deref() == Some("waiting");
    let is_busy = is_waiting || session.status.as_deref() == Some("busy");
    let status_since = session.status_updated_at.map(|t| t as i64);
    let pending = state.and_then(|s| s.latest_pending_tool(now));
    let activity = match (is_busy, state) {
        (false, _) => Activity { kind: "idle", label: "Aguardando você".into(), tool: None, since: status_since },
        _ if is_waiting => Activity {
            kind: "asking",
            label: pending.map_or_else(
                || "Esperando sua aprovação".into(),
                |tool| clip(&format!("Aprovar: {}", describe_tool(&tool.name, &tool.input)), crate::transcript::LABEL_MAX),
            ),
            tool: pending.map(|tool| tool.name.clone()),
            since: status_since,
        },
        (true, Some(state)) => activity_from_state(state, pending),
        (true, None) => Activity { kind: "thinking", label: "Trabalhando".into(), tool: None, since: status_since },
    };
    let project = Path::new(&session.cwd)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "sem projeto".into());

    Agent {
        id: session.session_id.clone(),
        pid: session.pid,
        name: session.name.clone().unwrap_or_else(|| session.session_id.chars().take(8).collect()),
        project,
        cwd: session.cwd.clone(),
        entrypoint: session.entrypoint.clone().unwrap_or_else(|| "cli".into()),
        editor: crate::editor::locate(session.pid).map(|host| host.name),
        status: if is_busy { "busy" } else { "idle" },
        started_at: session.started_at.map(|t| t as i64),
        title: state.and_then(|s| s.title.clone()),
        last_prompt: state.and_then(|s| s.last_prompt.as_deref()).map(|p| clip(p, PROMPT_MAX)),
        // The prompt may predate the replayed tail; the last event is then the closest bound.
        last_prompt_at: state.and_then(|s| s.last_prompt_at.or(s.last_event_at)),
        last_reply: state.and_then(|s| s.last_reply.clone()),
        steps: state.map(|s| s.steps.clone()).unwrap_or_default(),
        files: state
            .map(|s| {
                let prefix = format!("{}/", session.cwd.trim_end_matches('/'));
                s.files
                    .iter()
                    .rev()
                    .map(|f| FileTouch { rel: f.path.strip_prefix(&prefix).unwrap_or(&f.path).to_string(), path: f.path.clone(), at: f.at })
                    .collect()
            })
            .unwrap_or_default(),
        model: state.and_then(|s| s.model.clone()),
        activity,
        subagents: Vec::new(),
    }
}

/// Claude Code names project folders after the cwd with every non-alphanumeric char as "-".
pub fn project_slug(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn is_process_alive(pid: u32, proc_start: Option<&Value>) -> bool {
    if pid == 0 || !pid_exists(pid) {
        return false;
    }
    let Some(expected) = proc_start.map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string)) else {
        return true;
    };
    // Guards against PID reuse: field 22 of /proc/<pid>/stat is the process start time.
    match fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat
            .rfind(')')
            .and_then(|at| stat.get(at + 2..))
            .and_then(|fields| fields.split(' ').nth(19))
            .is_some_and(|start| start == expected),
        Err(_) => true, // no procfs (macOS): kill(0) is the best signal available
    }
}

#[cfg(unix)]
fn pid_exists(pid: u32) -> bool {
    // SAFETY: signal 0 only checks for existence/permission, nothing is delivered.
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_exists(_pid: u32) -> bool {
    true
}

fn list_dir(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir).map(|entries| entries.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_matches_claude_code_folder_naming() {
        assert_eq!(
            project_slug("/home/u/Code/Repositórios/web-app"),
            "-home-u-Code-Reposit-rios-web-app"
        );
        assert_eq!(project_slug("/home/u/.claude-mem/observer-sessions"), "-home-u--claude-mem-observer-sessions");
    }

    fn proc_start_of(pid: u32) -> String {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
        stat[stat.rfind(')').unwrap() + 2..].split(' ').nth(19).unwrap().to_string()
    }

    #[test]
    fn terminate_signals_only_the_registered_live_process() {
        let dir = std::env::temp_dir().join(format!("cpo-terminate-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut child = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        let session = serde_json::json!({"pid": child.id(), "sessionId": "abc", "procStart": proc_start_of(child.id())});
        fs::write(dir.join(format!("{}.json", child.id())), session.to_string()).unwrap();

        assert!(terminate_session_in(&dir, "other-session").is_err());
        assert_eq!(terminate_session_in(&dir, "abc"), Ok(1));
        let status = child.wait().unwrap();
        assert!(!status.success(), "sleep should have been killed by SIGTERM");
        assert!(terminate_session_in(&dir, "abc").is_err(), "a dead session cannot be ended twice");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn current_process_is_alive_and_wrong_start_time_is_not() {
        let pid = std::process::id();
        assert!(is_process_alive(pid, None));
        assert!(!is_process_alive(pid, Some(&Value::String("1".into()))));
    }
}
