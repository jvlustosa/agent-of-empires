//! Approving Claude Code permission prompts from the app.
//!
//! Claude Code runs `agent-of-empires --permission-hook` as a `PermissionRequest` hook. The hook
//! forwards the request over a private Unix socket and waits; the app lists it with Aprovar / Negar
//! / Responder no Cursor. With no answer in `APPROVAL_WINDOW`, or with the app closed, the hook
//! prints nothing and Claude Code shows its normal dialog, so the editor stays in charge.

use crate::transcript::describe_tool;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, ErrorKind, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const APPROVAL_WINDOW: Duration = Duration::from_secs(60);
/// "Aprovar tudo" in the panel: how long every permission prompt is allowed without asking.
pub const AUTO_APPROVE_WINDOW: Duration = Duration::from_secs(10 * 60);
// A little longer than the window so the app's "no answer" always arrives before we give up.
const HOOK_READ_TIMEOUT: Duration = Duration::from_secs(65);
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const DISCONNECT_POLL: Duration = Duration::from_millis(400);
const DETAIL_MAX_CHARS: usize = 4000;
// These tools are the conversation itself (a question, a plan): answering them here would skip them.
const EDITOR_ONLY_TOOLS: [&str; 2] = ["AskUserQuestion", "ExitPlanMode"];
pub const DENY_MESSAGE: &str = "Negado pelo Agent of Empires";
/// Set on agents the office hosts itself: they get prompts over stdio, so the hook stays out.
pub const HOSTED_ENV: &str = "CPO_HOSTED";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Allow,
    Deny,
    /// Hand the prompt back to the editor's own dialog.
    Ask,
}

/// A click in the panel: the decision plus, for AskUserQuestion, the chosen answers.
#[derive(Clone, Debug)]
pub struct Resolution {
    pub decision: Decision,
    pub answers: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: u64,
    pub session_id: String,
    pub tool_name: String,
    /// "permission" (approve / deny) or "question" (AskUserQuestion, answered with options).
    pub kind: &'static str,
    pub label: String,
    pub detail: Option<String>,
    pub questions: Option<Value>,
    /// Hosted agents wait for the office with no deadline and no editor to fall back to.
    pub is_hosted: bool,
    pub requested_at: i64,
    pub expires_at: Option<i64>,
}

type Listener = Box<dyn Fn(Vec<ApprovalRequest>) + Send + Sync>;

pub struct Approvals {
    pending: Mutex<HashMap<u64, (ApprovalRequest, mpsc::Sender<Resolution>)>>,
    next_id: AtomicU64,
    /// Until when (ms since the epoch) permission prompts are allowed on arrival; 0 is off.
    auto_allow_until: AtomicI64,
    on_change: Listener,
}

impl Approvals {
    pub fn new(on_change: Listener) -> Arc<Self> {
        Arc::new(Self { pending: Mutex::new(HashMap::new()), next_id: AtomicU64::new(1), auto_allow_until: AtomicI64::new(0), on_change })
    }

    pub fn list(&self) -> Vec<ApprovalRequest> {
        let mut list: Vec<_> = self.pending.lock().map(|p| p.values().map(|(r, _)| r.clone()).collect()).unwrap_or_default();
        list.sort_by_key(|r| r.id);
        list
    }

    pub fn resolve(&self, id: u64, decision: Decision, answers: Option<Value>) -> bool {
        self.pending
            .lock()
            .ok()
            .and_then(|p| p.get(&id).map(|(_, tx)| tx.send(Resolution { decision, answers }).is_ok()))
            .unwrap_or(false)
    }

    /// Allows every permission prompt for `window` (None turns it off), starting with the ones
    /// already waiting. Questions and plans still ask. Returns when it ends, in ms.
    pub fn set_auto_allow(&self, window: Option<Duration>) -> Option<i64> {
        let until = window.map(|w| now_ms() + w.as_millis() as i64);
        self.auto_allow_until.store(until.unwrap_or(0), Ordering::Relaxed);
        if until.is_some() {
            for request in self.list().into_iter().filter(|r| is_auto_allowed(r.kind, &r.tool_name)) {
                self.resolve(request.id, Decision::Allow, None);
            }
        }
        until
    }

    pub fn auto_allow_until(&self) -> Option<i64> {
        let until = self.auto_allow_until.load(Ordering::Relaxed);
        (until > now_ms()).then_some(until)
    }

    fn notify(&self) {
        (self.on_change)(self.list());
    }

    /// Lists the prompt and blocks until it is answered, `window` runs out, or `is_gone` says the
    /// asker went away (hook killed, hosted agent exited). While auto-approve is on, allows at once.
    pub fn ask(
        &self,
        session_id: &str,
        tool_name: &str,
        input: &Value,
        window: Option<Duration>,
        is_hosted: bool,
        is_gone: &dyn Fn() -> bool,
    ) -> Option<Resolution> {
        let is_question = tool_name == "AskUserQuestion";
        let kind = if is_question { "question" } else { "permission" };
        if is_auto_allowed(kind, tool_name) && self.auto_allow_until().is_some() {
            return Some(Resolution { decision: Decision::Allow, answers: None });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let now = now_ms();
        let entry = ApprovalRequest {
            id,
            session_id: session_id.to_string(),
            tool_name: tool_name.to_string(),
            kind,
            label: if is_question { "Pergunta para você".into() } else { describe_tool(tool_name, input) },
            detail: if is_question { None } else { tool_detail(tool_name, input) },
            questions: if is_question { input.get("questions").cloned() } else { None },
            is_hosted,
            requested_at: now,
            expires_at: window.map(|w| now + w.as_millis() as i64),
        };
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, (entry, tx));
        }
        self.notify();

        let deadline = window.map(|w| Instant::now() + w);
        let resolution = loop {
            match rx.recv_timeout(DISCONNECT_POLL) {
                Ok(resolution) => break Some(resolution),
                Err(RecvTimeoutError::Disconnected) => break None,
                Err(RecvTimeoutError::Timeout) if deadline.is_some_and(|d| Instant::now() >= d) || is_gone() => break None,
                Err(RecvTimeoutError::Timeout) => {}
            }
        };
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
        self.notify();
        resolution
    }

    /// Hook path (editor sessions): 60 s, then Claude Code shows its own dialog.
    fn wait_for_decision(&self, request: &Value, stream: &UnixStream) -> Option<Decision> {
        let session_id = request.get("session_id").and_then(Value::as_str).unwrap_or_default();
        let tool_name = request.get("tool_name").and_then(Value::as_str).unwrap_or("tool");
        let input = request.get("tool_input").cloned().unwrap_or(Value::Null);
        self.ask(session_id, tool_name, &input, Some(APPROVAL_WINDOW), false, &|| is_peer_gone(stream))
            .map(|r| r.decision)
            .filter(|d| *d != Decision::Ask)
    }
}

fn is_auto_allowed(kind: &str, tool_name: &str) -> bool {
    kind == "permission" && !EDITOR_ONLY_TOOLS.contains(&tool_name)
}

// The hook sends a single line and then only reads, so EOF on our side means it was killed.
fn is_peer_gone(stream: &UnixStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let mut probe = [0u8; 1];
    let gone = matches!((&*stream).read(&mut probe), Ok(0));
    let _ = stream.set_nonblocking(false);
    gone
}

/// The exact thing being approved: the full command, the file, the URL.
fn tool_detail(tool_name: &str, input: &Value) -> Option<String> {
    let field = |key: &str| input.get(key).and_then(Value::as_str).map(str::to_string);
    let detail = match tool_name {
        "Bash" => field("command"),
        "Edit" | "MultiEdit" | "Write" | "Read" | "NotebookEdit" => field("file_path").or_else(|| field("notebook_path")),
        "WebFetch" => field("url"),
        "WebSearch" => field("query"),
        "ExitPlanMode" => field("plan"),
        _ if input.is_null() => None,
        _ => serde_json::to_string_pretty(input).ok(),
    }?;
    if detail.chars().count() <= DETAIL_MAX_CHARS {
        return Some(detail);
    }
    let mut clipped: String = detail.chars().take(DETAIL_MAX_CHARS).collect();
    clipped.push_str("\n… (cortado)");
    Some(clipped)
}

pub fn socket_path() -> PathBuf {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    runtime.join("agent-of-empires").join("permission.sock")
}

/// Starts accepting hook connections; one thread per pending request.
pub fn serve(approvals: Arc<Approvals>, socket: &Path) -> io::Result<()> {
    let dir = socket.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    match fs::remove_file(socket) {
        Err(err) if err.kind() != ErrorKind::NotFound => return Err(err),
        _ => {}
    }
    let listener = UnixListener::bind(socket)?;
    fs::set_permissions(socket, fs::Permissions::from_mode(0o600))?;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let approvals = approvals.clone();
            thread::spawn(move || handle_connection(&approvals, stream));
        }
    });
    Ok(())
}

fn handle_connection(approvals: &Approvals, mut stream: UnixStream) {
    let _ = stream.set_read_timeout(Some(REQUEST_READ_TIMEOUT));
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return;
    }
    let Ok(request) = serde_json::from_str::<Value>(&line) else { return };
    let reply = match approvals.wait_for_decision(&request, &stream) {
        Some(Decision::Allow) => json!({"behavior": "allow"}),
        Some(Decision::Deny) => json!({"behavior": "deny"}),
        _ => json!({}),
    };
    let _ = writeln!(stream, "{reply}");
}

/// Hook side. Returns what to print on stdout, or None to leave the decision to the editor.
/// Every failure maps to None: a broken app must never block or decide a permission.
pub fn run_hook(socket: &Path, input: &str) -> Option<String> {
    let request: Value = serde_json::from_str(input).ok()?;
    let tool_name = request.get("tool_name").and_then(Value::as_str).unwrap_or_default();
    if EDITOR_ONLY_TOOLS.contains(&tool_name) {
        return None;
    }
    let mut stream = UnixStream::connect(socket).ok()?; // app closed
    stream.set_read_timeout(Some(HOOK_READ_TIMEOUT)).ok()?;
    writeln!(stream, "{}", serde_json::to_string(&request).ok()?).ok()?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).ok()?;
    let behavior = serde_json::from_str::<Value>(&reply).ok()?.get("behavior")?.as_str()?.to_string();
    let decision = match behavior.as_str() {
        "allow" => json!({"behavior": "allow"}),
        "deny" => json!({"behavior": "deny", "message": DENY_MESSAGE}),
        _ => return None,
    };
    Some(json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}}).to_string())
}

pub fn hook_main() {
    if std::env::var_os(HOSTED_ENV).is_some() {
        return; // the office already hosts this agent and answers it over stdio
    }
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_ok() {
        if let Some(output) = run_hook(&socket_path(), &input) {
            println!("{output}");
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_socket(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("cpo-approval-{}-{name}", std::process::id())).join("permission.sock")
    }

    fn bash_request(command: &str) -> String {
        json!({"session_id": "s1", "hook_event_name": "PermissionRequest", "tool_name": "Bash",
            "tool_input": {"command": command, "description": "Limpa o build"}})
        .to_string()
    }

    // Resolves the first request that shows up with `decision`, like a click in the panel.
    fn approvals_answering(decision: Decision) -> Arc<Approvals> {
        let slot: Arc<Mutex<Option<Arc<Approvals>>>> = Arc::new(Mutex::new(None));
        let slot_for_listener = slot.clone();
        let approvals = Approvals::new(Box::new(move |list| {
            if let (Some(first), Some(approvals)) = (list.first(), slot_for_listener.lock().unwrap().clone()) {
                let id = first.id;
                thread::spawn(move || approvals.resolve(id, decision, None));
            }
        }));
        *slot.lock().unwrap() = Some(approvals.clone());
        approvals
    }

    #[test]
    fn allow_in_the_panel_becomes_an_allow_decision() {
        let socket = temp_socket("allow");
        serve(approvals_answering(Decision::Allow), &socket).unwrap();
        let output: Value = serde_json::from_str(&run_hook(&socket, &bash_request("rm -rf build")).unwrap()).unwrap();
        assert_eq!(output["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(output["hookSpecificOutput"]["decision"]["behavior"], "allow");
    }

    #[test]
    fn deny_carries_a_message_for_claude() {
        let socket = temp_socket("deny");
        serve(approvals_answering(Decision::Deny), &socket).unwrap();
        let output: Value = serde_json::from_str(&run_hook(&socket, &bash_request("rm -rf /")).unwrap()).unwrap();
        assert_eq!(output["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert_eq!(output["hookSpecificOutput"]["decision"]["message"], DENY_MESSAGE);
    }

    #[test]
    fn responder_no_cursor_leaves_the_decision_to_the_editor() {
        let socket = temp_socket("ask");
        serve(approvals_answering(Decision::Ask), &socket).unwrap();
        assert_eq!(run_hook(&socket, &bash_request("ls")), None);
    }

    #[test]
    fn app_closed_means_normal_dialog() {
        assert_eq!(run_hook(&temp_socket("closed"), &bash_request("ls")), None);
    }

    #[test]
    fn questions_and_plans_never_go_through_the_panel() {
        let socket = temp_socket("question");
        serve(approvals_answering(Decision::Allow), &socket).unwrap();
        let question = json!({"session_id": "s1", "tool_name": "AskUserQuestion", "tool_input": {}}).to_string();
        assert_eq!(run_hook(&socket, &question), None);
    }

    #[test]
    fn auto_approve_allows_permissions_but_still_asks_questions() {
        let approvals = Approvals::new(Box::new(|_| {}));
        approvals.set_auto_allow(Some(AUTO_APPROVE_WINDOW));
        let quick = Some(Duration::from_millis(1));
        let bash = approvals.ask("s1", "Bash", &json!({"command": "ls"}), quick, false, &|| false);
        assert_eq!(bash.map(|r| r.decision), Some(Decision::Allow));
        assert!(approvals.ask("s1", "AskUserQuestion", &json!({}), quick, false, &|| false).is_none());
        approvals.set_auto_allow(None);
        assert!(approvals.ask("s1", "Bash", &json!({"command": "ls"}), quick, false, &|| false).is_none());
    }

    #[test]
    fn full_command_is_shown_for_approval() {
        let detail = tool_detail("Bash", &json!({"command": "git push --force origin main", "description": "Publica"}));
        assert_eq!(detail.as_deref(), Some("git push --force origin main"));
    }
}
