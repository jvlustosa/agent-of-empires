//! Agents the office runs itself, the way the Cursor extension does: `claude` in SDK streaming
//! mode. The task starts right away (no Enter), and every tool permission or AskUserQuestion comes
//! back as a control request that the office answers with a click.

use crate::approval::{Approvals, Decision, Resolution, DENY_MESSAGE, HOSTED_ENV};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

// The last flag is variadic, so the deny rules must stay at the end. They are a hard stop, not
// advice: pushing to main or force-pushing never reaches the approval card at all.
const CLAUDE_ARGS: &[&str] = &[
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-prompt-tool",
    "stdio",
    "--disallowedTools",
    "Bash(git push origin main:*)",
    "Bash(git push -u origin main:*)",
    "Bash(git push origin HEAD:main:*)",
    "Bash(git push origin +main:*)",
    "Bash(git push --force:*)",
    "Bash(git push -f:*)",
];

type SharedStdin = Arc<Mutex<ChildStdin>>;
type Listener = Box<dyn Fn(Vec<String>) + Send + Sync>;

struct HostedAgent {
    stdin: SharedStdin,
    pid: u32,
}

pub struct Hosted {
    claude: PathBuf,
    approvals: Arc<Approvals>,
    agents: Mutex<HashMap<String, HostedAgent>>,
    on_change: Listener,
}

/// Editor-terminal leftovers would tag a `claude` we start as an IDE session or hook it to the IDE.
pub fn strip_editor_env(command: &mut Command) {
    for (key, _) in std::env::vars_os() {
        let key_text = key.to_string_lossy();
        let is_editor_leak = key_text == "ELECTRON_RUN_AS_NODE"
            || key_text.starts_with("VSCODE_")
            || key_text == "CLAUDE_CODE_ENTRYPOINT"
            || key_text == "CLAUDE_CODE_SSE_PORT";
        if is_editor_leak {
            command.env_remove(&key);
        }
    }
}

/// The CLI the app launches; GNOME autostart has no ~/.local/bin on PATH, so look there first.
pub fn find_claude() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    [".local/bin/claude", ".claude/local/claude"]
        .iter()
        .filter_map(|relative| home.as_ref().map(|h| h.join(relative)))
        .find(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from("claude"))
}

impl Hosted {
    pub fn new(claude: PathBuf, approvals: Arc<Approvals>, on_change: Listener) -> Arc<Self> {
        Arc::new(Self { claude, approvals, agents: Mutex::new(HashMap::new()), on_change })
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.agents.lock().map(|agents| agents.keys().cloned().collect()).unwrap_or_default()
    }

    pub fn pid_of(&self, session_id: &str) -> Option<u32> {
        self.agents.lock().ok()?.get(session_id).map(|agent| agent.pid)
    }

    /// `resume` continues that past session (run from the folder it ran in), with `task` as its next turn.
    pub fn spawn(self: &Arc<Self>, cwd: &Path, task: &str, resume: Option<&str>) -> Result<(), String> {
        let mut command = Command::new(&self.claude);
        if let Some(session_id) = resume {
            command.arg("--resume").arg(session_id); // before CLAUDE_ARGS, whose last flag swallows the rest
        }
        command.args(CLAUDE_ARGS).current_dir(cwd).env(HOSTED_ENV, "1");
        strip_editor_env(&mut command);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("Não consegui iniciar o claude ({}): {err}", self.claude.display()))?;
        let stdin: SharedStdin = Arc::new(Mutex::new(child.stdin.take().ok_or("claude sem stdin")?));
        let stdout = child.stdout.take().ok_or("claude sem stdout")?;
        write_line(&stdin, &json!({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize"}}))?;
        write_line(&stdin, &user_message(task))?;
        let hosted = self.clone();
        thread::spawn(move || hosted.pump(child, stdin, stdout));
        Ok(())
    }

    /// Sends the next user turn to an agent the office hosts ("seguir em frente", a reply).
    pub fn send(&self, session_id: &str, text: &str) -> Result<(), String> {
        let stdin = self
            .agents
            .lock()
            .map_err(|_| "Estado indisponível".to_string())?
            .get(session_id)
            .map(|agent| agent.stdin.clone())
            .ok_or("Esse agente não está rodando aqui no app")?;
        write_line(&stdin, &user_message(text))
    }

    fn set_agent(&self, session_id: &str, agent: Option<HostedAgent>) {
        if let Ok(mut agents) = self.agents.lock() {
            match agent {
                Some(agent) => agents.insert(session_id.to_string(), agent),
                None => agents.remove(session_id),
            };
        }
        (self.on_change)(self.session_ids());
    }

    fn pump(self: Arc<Self>, mut child: Child, stdin: SharedStdin, stdout: ChildStdout) {
        let is_gone = Arc::new(AtomicBool::new(false));
        let mut session_id: Option<String> = None;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            match message.get("type").and_then(Value::as_str) {
                Some("system") if session_id.is_none() && message.get("subtype").and_then(Value::as_str) == Some("init") => {
                    if let Some(id) = message.get("session_id").and_then(Value::as_str) {
                        session_id = Some(id.to_string());
                        self.set_agent(id, Some(HostedAgent { stdin: stdin.clone(), pid: child.id() }));
                    }
                }
                Some("control_request") => self.answer_later(&message, session_id.clone().unwrap_or_default(), &stdin, &is_gone),
                _ => {}
            }
        }
        is_gone.store(true, Ordering::Relaxed);
        let _ = child.wait();
        if let Some(id) = session_id {
            self.set_agent(&id, None);
        }
    }

    // Each prompt waits on its own thread, so the agent's other output keeps flowing meanwhile.
    fn answer_later(&self, message: &Value, session_id: String, stdin: &SharedStdin, is_gone: &Arc<AtomicBool>) {
        let request = message.get("request").cloned().unwrap_or(Value::Null);
        if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
            return;
        }
        let request_id = message.get("request_id").and_then(Value::as_str).unwrap_or_default().to_string();
        let tool_name = request.get("tool_name").and_then(Value::as_str).unwrap_or("tool").to_string();
        let input = request.get("input").cloned().unwrap_or_else(|| json!({}));
        let (approvals, stdin, is_gone) = (self.approvals.clone(), stdin.clone(), is_gone.clone());
        thread::spawn(move || {
            let gone = is_gone.clone();
            let resolution = approvals.ask(&session_id, &tool_name, &input, None, true, &move || gone.load(Ordering::Relaxed));
            if let Some(resolution) = resolution {
                if let Err(err) = write_line(&stdin, &control_response(&request_id, &input, &resolution)) {
                    eprintln!("[hosted] could not answer {tool_name}: {err}");
                }
            }
        });
    }
}

/// Allow carries the (possibly answered) input back; anything else is a deny Claude can react to.
pub fn control_response(request_id: &str, input: &Value, resolution: &Resolution) -> Value {
    let response = match resolution.decision {
        Decision::Allow => {
            let mut updated = input.clone();
            if let (Some(answers), Some(fields)) = (&resolution.answers, updated.as_object_mut()) {
                fields.insert("answers".into(), answers.clone());
            }
            json!({"behavior": "allow", "updatedInput": updated})
        }
        Decision::Deny | Decision::Ask => json!({"behavior": "deny", "message": DENY_MESSAGE}),
    };
    json!({"type": "control_response", "response": {"subtype": "success", "request_id": request_id, "response": response}})
}

fn user_message(text: &str) -> Value {
    json!({"type": "user", "session_id": "", "parent_tool_use_id": null, "message": {"role": "user", "content": text}})
}

fn write_line(stdin: &SharedStdin, value: &Value) -> Result<(), String> {
    let mut stdin = stdin.lock().map_err(|_| "Canal do agente indisponível".to_string())?;
    writeln!(stdin, "{value}").and_then(|_| stdin.flush()).map_err(|err| format!("O agente não recebeu a mensagem: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    // A stand-in for `claude`: announces a session, asks one question, records the answer it gets.
    const FAKE_CLAUDE: &str = r#"#!/usr/bin/env python3
import json, os, sys
log = open(os.environ['FAKE_LOG'], 'a')
lines = iter(sys.stdin)
first, task = json.loads(next(lines)), json.loads(next(lines))
log.write(json.dumps({"task": task["message"]["content"]}) + "\n"); log.flush()
print(json.dumps({"type": "system", "subtype": "init", "session_id": "fake-1"}), flush=True)
print(json.dumps({"type": "control_request", "request_id": "r1", "request": {"subtype": "can_use_tool",
    "tool_name": "AskUserQuestion", "input": {"questions": [{"question": "Cor?", "options": [{"label": "Azul"}, {"label": "Verde"}]}]}}}), flush=True)
for line in lines:
    log.write(line); log.flush()
"#;

    #[test]
    fn task_starts_immediately_and_question_answers_reach_the_agent() {
        let dir = std::env::temp_dir().join(format!("cpo-hosted-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("claude");
        std::fs::write(&fake, FAKE_CLAUDE).unwrap();
        std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let log = dir.join("log.jsonl");
        std::env::set_var("FAKE_LOG", &log);

        // Answers the first prompt like a click on "Verde" in the office.
        let slot: Arc<Mutex<Option<Arc<Approvals>>>> = Arc::new(Mutex::new(None));
        let slot_for_listener = slot.clone();
        let approvals = Approvals::new(Box::new(move |list| {
            if let (Some(first), Some(approvals)) = (list.first(), slot_for_listener.lock().unwrap().clone()) {
                assert_eq!(first.kind, "question");
                assert!(first.is_hosted && first.expires_at.is_none());
                let id = first.id;
                thread::spawn(move || approvals.resolve(id, Decision::Allow, Some(json!({"Cor?": "Verde"}))));
            }
        }));
        *slot.lock().unwrap() = Some(approvals.clone());
        let hosted = Hosted::new(fake, approvals, Box::new(|_| {}));
        hosted.spawn(&dir, "revisar o PR", None).unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        let answered = loop {
            let text = std::fs::read_to_string(&log).unwrap_or_default();
            if text.contains("control_response") || Instant::now() > deadline {
                break text;
            }
            thread::sleep(Duration::from_millis(50));
        };
        assert!(answered.contains(r#""task": "revisar o PR""#), "task was not sent on start: {answered}");
        let response: Value = serde_json::from_str(answered.lines().find(|l| l.contains("control_response")).unwrap()).unwrap();
        assert_eq!(response["response"]["request_id"], "r1");
        assert_eq!(response["response"]["response"]["behavior"], "allow");
        assert_eq!(response["response"]["response"]["updatedInput"]["answers"]["Cor?"], "Verde");
        assert_eq!(hosted.session_ids(), ["fake-1"]);
        hosted.send("fake-1", "seguir em frente").unwrap();
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn deny_tells_claude_why() {
        let resolution = Resolution { decision: Decision::Deny, answers: None };
        let response = control_response("r9", &json!({"command": "rm -rf /"}), &resolution);
        assert_eq!(response["response"]["response"]["behavior"], "deny");
        assert_eq!(response["response"]["response"]["message"], DENY_MESSAGE);
    }
}
