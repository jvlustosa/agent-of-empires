//! Incremental reader for Claude Code transcripts (`~/.claude/projects/<slug>/<session>.jsonl`).
//!
//! Only appended bytes are parsed after the first read, so polling every second stays cheap
//! even for transcripts with tens of megabytes.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

// On first read only the tail is replayed for tool state; title/prompt are found by byte search.
const BOOTSTRAP_TAIL_BYTES: usize = 512 * 1024;
// A tool_use with no tool_result for this long is treated as abandoned (interrupted turn).
const PENDING_TOOL_MAX_AGE_MS: i64 = 30 * 60 * 1000;
pub const LABEL_MAX: usize = 72;
const REPLY_MAX: usize = 240;
// The timeline shows the current turn; very long turns keep their latest steps.
const STEPS_MAX: usize = 60;
const FILES_MAX: usize = 40;
const EDIT_TOOLS: [&str; 4] = ["Edit", "MultiEdit", "Write", "NotebookEdit"];

/// One tool call in the current turn, for the task timeline.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Step {
    pub kind: &'static str,
    pub at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TouchedFile {
    pub path: String,
    pub at: Option<i64>,
}

pub(crate) const TITLE_MARKER: &[u8] = br#""type":"ai-title""#;
pub(crate) const PROMPT_MARKER: &[u8] = br#""type":"last-prompt""#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LastKind {
    Prompt,
    Thinking,
    Text,
    Tool,
    ToolResult,
}

/// The session's latest successful push or merge: the map celebrates it for a while.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct GitEvent {
    pub kind: &'static str,
    pub at: Option<i64>,
}

impl GitEvent {
    pub fn latest(a: Option<GitEvent>, b: Option<GitEvent>) -> Option<GitEvent> {
        a.into_iter().chain(b).max_by_key(|event| event.at)
    }
}

#[derive(Clone, Debug)]
pub struct PendingTool {
    pub name: String,
    pub input: Value,
    pub at: Option<i64>,
}

#[derive(Debug, Default)]
pub struct TranscriptState {
    pub title: Option<String>,
    pub last_prompt: Option<String>,
    pub last_prompt_at: Option<i64>,
    /// Last thing Claude said: when the turn ends, it is what the user has to answer.
    pub last_reply: Option<String>,
    /// Tool calls since the last prompt, oldest first.
    pub steps: Vec<Step>,
    /// Files this session edited, most recent edit last (one entry per path).
    pub files: Vec<TouchedFile>,
    pub model: Option<String>,
    pub last_kind: Option<LastKind>,
    pub last_event_at: Option<i64>,
    pub pending: HashMap<String, PendingTool>,
    pub git: Option<GitEvent>,
    /// The branch checked out in the session's folder, as Claude Code stamps on each entry.
    pub branch: Option<String>,
    pub mtime_ms: i64,
}

impl TranscriptState {
    pub fn latest_pending_tool(&self, now: i64) -> Option<&PendingTool> {
        self.pending
            .values()
            .filter(|tool| tool.at.map_or(true, |at| now - at <= PENDING_TOOL_MAX_AGE_MS))
            .max_by_key(|tool| tool.at.unwrap_or(0))
    }

    pub fn apply_entry(&mut self, entry: &Value) {
        if let Some(at) = entry.get("timestamp").and_then(Value::as_str).and_then(parse_timestamp_ms) {
            self.last_event_at = Some(at);
        }
        if let Some(branch) = non_empty_str(entry.get("gitBranch")) {
            self.branch = Some(branch);
        }
        let at = self.last_event_at;
        match entry.get("type").and_then(Value::as_str) {
            Some("ai-title") => {
                if let Some(title) = non_empty_str(entry.get("aiTitle")) {
                    self.title = Some(title);
                }
            }
            Some("last-prompt") => {
                if let Some(prompt) = non_empty_str(entry.get("lastPrompt")) {
                    self.last_prompt = Some(prompt);
                }
            }
            Some("assistant") => {
                if let Some(message) = entry.get("message") {
                    self.apply_assistant(message, at);
                }
            }
            Some("user") if !entry.get("isMeta").and_then(Value::as_bool).unwrap_or(false) => {
                if let Some(message) = entry.get("message") {
                    self.apply_user(message, at);
                }
            }
            _ => {}
        }
    }

    fn apply_assistant(&mut self, message: &Value, at: Option<i64>) {
        if let Some(model) = message.get("model").and_then(Value::as_str) {
            if !model.starts_with('<') {
                self.model = Some(model.to_string());
            }
        }
        let Some(blocks) = message.get("content").and_then(Value::as_array) else {
            return;
        };
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("tool_use") => {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or_default();
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    self.record_step(name, &input, at);
                    self.pending.insert(id.to_string(), PendingTool { name: name.to_string(), input, at });
                    self.last_kind = Some(LastKind::Tool);
                }
                Some("text") => {
                    if let Some(text) = non_empty_str(block.get("text")) {
                        self.last_reply = Some(clip(&text, REPLY_MAX));
                        self.last_kind = Some(LastKind::Text);
                    }
                }
                Some("thinking") => self.last_kind = Some(LastKind::Thinking),
                _ => {}
            }
        }
    }

    fn record_step(&mut self, name: &str, input: &Value, at: Option<i64>) {
        self.steps.push(Step { kind: step_kind(name, input), at });
        if self.steps.len() > STEPS_MAX {
            self.steps.remove(0);
        }
        if !EDIT_TOOLS.contains(&name) {
            return;
        }
        let path = ["file_path", "notebook_path"].iter().find_map(|key| input.get(*key).and_then(Value::as_str));
        if let Some(path) = path {
            self.files.retain(|file| file.path != path);
            self.files.push(TouchedFile { path: path.to_string(), at });
            if self.files.len() > FILES_MAX {
                self.files.remove(0);
            }
        }
    }

    fn apply_user(&mut self, message: &Value, at: Option<i64>) {
        let results: Vec<(&str, bool)> = message
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
                    .filter_map(|b| {
                        let is_error = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                        b.get("tool_use_id").and_then(Value::as_str).map(|id| (id, is_error))
                    })
                    .collect()
            })
            .unwrap_or_default();

        if results.is_empty() {
            // A fresh prompt starts a new turn: anything still pending was interrupted.
            self.pending.clear();
            self.steps.clear();
            self.last_kind = Some(LastKind::Prompt);
            self.last_prompt_at = at;
            return;
        }
        for (id, is_error) in results {
            let Some(tool) = self.pending.remove(id) else { continue };
            // Only a command that went through counts: a rejected push or a denied one is no news.
            if is_error || tool.name != "Bash" {
                continue;
            }
            let command = tool.input.get("command").and_then(Value::as_str).unwrap_or_default();
            if let Some(kind) = git_action(command) {
                self.git = Some(GitEvent { kind, at });
            }
        }
        self.last_kind = Some(LastKind::ToolResult);
    }
}

pub struct TranscriptTracker {
    path: PathBuf,
    offset: u64,
    partial: Vec<u8>,
    is_bootstrapped: bool,
    pub state: TranscriptState,
}

impl TranscriptTracker {
    pub fn new(path: PathBuf) -> Self {
        Self { path, offset: 0, partial: Vec::new(), is_bootstrapped: false, state: TranscriptState::default() }
    }

    fn reset(&mut self) {
        self.offset = 0;
        self.partial.clear();
        self.is_bootstrapped = false;
        self.state = TranscriptState::default();
    }

    pub fn refresh(&mut self) -> &TranscriptState {
        let Ok(meta) = fs::metadata(&self.path) else {
            return &self.state;
        };
        let size = meta.len();
        if size < self.offset {
            self.reset(); // file rewritten
        }
        if size > self.offset {
            let result = if self.is_bootstrapped { self.read_range(self.offset, size) } else { self.bootstrap() };
            if let Err(err) = result {
                eprintln!("[transcript] failed to read {}: {err}", self.path.display());
            }
        }
        self.state.mtime_ms = mtime_ms(&meta);
        &self.state
    }

    fn bootstrap(&mut self) -> io::Result<()> {
        let buf = fs::read(&self.path)?;
        for marker in [TITLE_MARKER, PROMPT_MARKER] {
            if let Some(entry) = last_marked_line(&buf, marker) {
                self.state.apply_entry(&entry);
            }
        }
        let mut start = buf.len().saturating_sub(BOOTSTRAP_TAIL_BYTES);
        if start > 0 {
            start = find_byte(&buf, b'\n', start).map_or(buf.len(), |at| at + 1);
        }
        self.consume(&buf[start..]);
        self.offset = buf.len() as u64;
        self.is_bootstrapped = true;
        Ok(())
    }

    fn read_range(&mut self, from: u64, to: u64) -> io::Result<()> {
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(from))?;
        let mut buf = vec![0; (to - from) as usize];
        file.read_exact(&mut buf)?;
        self.consume(&buf);
        self.offset = to;
        Ok(())
    }

    // Keeps the trailing partial line as bytes so multi-byte chars split across reads survive.
    pub fn consume(&mut self, chunk: &[u8]) {
        let mut data = std::mem::take(&mut self.partial);
        data.extend_from_slice(chunk);
        let mut line_start = 0;
        while let Some(newline_at) = find_byte(&data, b'\n', line_start) {
            if let Some(entry) = parse_line(&data[line_start..newline_at]) {
                self.state.apply_entry(&entry);
            }
            line_start = newline_at + 1;
        }
        self.partial = data[line_start..].to_vec();
    }
}

fn find_byte(haystack: &[u8], needle: u8, from: usize) -> Option<usize> {
    haystack.get(from..)?.iter().position(|&b| b == needle).map(|at| at + from)
}

fn last_marked_line(buf: &[u8], marker: &[u8]) -> Option<Value> {
    let at = buf.windows(marker.len()).rposition(|window| window == marker)?;
    let start = buf[..at].iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    let end = find_byte(buf, b'\n', at).unwrap_or(buf.len());
    parse_line(&buf[start..end])
}

pub(crate) fn parse_line(line: &[u8]) -> Option<Value> {
    if line.is_empty() {
        return None;
    }
    serde_json::from_slice(line).ok() // half-written lines are skipped, the next read completes them
}

pub(crate) fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis() as i64)
}

/// Parses the `2026-09-30T16:23:22.576Z` timestamps written by Claude Code (always UTC).
pub fn parse_timestamp_ms(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let millis = match text.get(19..20) {
        Some(".") => {
            let digits: String = text[20..].chars().take_while(char::is_ascii_digit).take(3).collect();
            format!("{digits:0<3}").parse::<i64>().ok()?
        }
        _ => 0,
    };
    // Howard Hinnant's days_from_civil.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

pub fn tool_kind(name: &str) -> &'static str {
    match name {
        "Bash" | "BashOutput" | "KillShell" | "Monitor" => "terminal",
        "Read" | "Grep" | "Glob" | "LS" | "Skill" | "ToolSearch" => "reading",
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => "coding",
        "WebFetch" | "WebSearch" => "web",
        "Agent" | "Task" | "Workflow" | "SendMessage" => "delegating",
        "TodoWrite" | "TaskCreate" | "TaskUpdate" | "EnterPlanMode" => "planning",
        "AskUserQuestion" | "ExitPlanMode" => "asking",
        _ => "tool",
    }
}

/// tool_kind, with the shell's git and gh calls set apart: the map shows them as git work.
pub fn step_kind(name: &str, input: &Value) -> &'static str {
    let command = input.get("command").and_then(Value::as_str);
    if name == "Bash" && command.is_some_and(runs_git) {
        "git"
    } else {
        tool_kind(name)
    }
}

// Any command in the line runs git or gh; as with git_action, quoted mentions don't count.
fn runs_git(command: &str) -> bool {
    shell_commands(command).iter().any(|words| matches!(program_of(&command_words(words)), Some("git" | "gh")))
}

/// "push" for `git push`, "merge" for `git merge` or `gh pr merge`, None otherwise. In a chain
/// (`git merge x && git push`) the last one wins; quoted text, like a commit message, never counts.
pub fn git_action(command: &str) -> Option<&'static str> {
    shell_commands(command).iter().filter_map(|words| git_action_of(words)).last()
}

fn git_action_of(words: &[String]) -> Option<&'static str> {
    let words = command_words(words);
    let program = program_of(&words)?;
    let args = &words[1..];
    let has = |flags: &[&str]| args.iter().any(|arg| flags.contains(arg));
    match program {
        "gh" => (args.len() >= 2 && args[..2] == ["pr", "merge"]).then_some("merge"),
        "git" => match git_subcommand(args)? {
            "push" if !has(&["--dry-run", "-n"]) => Some("push"),
            "merge" if !has(&["--abort", "--quit"]) => Some("merge"),
            _ => None,
        },
        _ => None,
    }
}

// The words past leading `VAR=value` assignments.
fn command_words(words: &[String]) -> Vec<&str> {
    words.iter().map(String::as_str).skip_while(|w| w.contains('=') && !w.starts_with('-')).collect()
}

// The program's name without its path (`/usr/bin/git` is git).
fn program_of<'a>(words: &[&'a str]) -> Option<&'a str> {
    words.first()?.rsplit('/').next()
}

// The subcommand past git's own options (`git -C repo -c k=v push`).
fn git_subcommand<'a>(args: &[&'a str]) -> Option<&'a str> {
    let mut args = args.iter();
    while let Some(&arg) = args.next() {
        if arg == "-C" || arg == "-c" {
            args.next();
        } else if !arg.starts_with('-') {
            return Some(arg);
        }
    }
    None
}

// The words of each simple command in a shell line, split at ; & | ( ) and newlines outside quotes.
fn shell_commands(line: &str) -> Vec<Vec<String>> {
    let mut commands = vec![Vec::new()];
    let mut word = String::new();
    let mut quote = None;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some('"'), '\\') => word.extend(chars.next()),
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => word.push(c),
            (None, '\'' | '"') => quote = Some(c),
            (None, '\\') => word.extend(chars.next()),
            (None, ' ' | '\t' | ';' | '&' | '|' | '(' | ')' | '\n') => {
                let words = commands.last_mut().expect("never empty");
                if !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                if !matches!(c, ' ' | '\t') && !words.is_empty() {
                    commands.push(Vec::new());
                }
            }
            _ => word.push(c),
        }
    }
    if !word.is_empty() {
        commands.last_mut().expect("never empty").push(word);
    }
    commands
}

pub fn describe_tool(name: &str, input: &Value) -> String {
    let field = |key: &str| input.get(key).and_then(Value::as_str).unwrap_or_default();
    let file = [field("file_path"), field("notebook_path"), field("path")]
        .into_iter()
        .find(|path| !path.is_empty())
        .map(|path| Path::new(path).file_name().map_or(path.to_string(), |n| n.to_string_lossy().into_owned()))
        .unwrap_or_default();

    let label = match name {
        "Bash" => {
            let description = field("description");
            let summary = if description.is_empty() { field("command").lines().next().unwrap_or_default() } else { description };
            format!("$ {summary}")
        }
        "Read" => format!("Lendo {file}"),
        "Edit" | "MultiEdit" | "NotebookEdit" => format!("Editando {file}"),
        "Write" => format!("Escrevendo {file}"),
        "Grep" => format!("Buscando \"{}\"", field("pattern")),
        "Glob" => format!("Procurando {}", field("pattern")),
        "WebFetch" => format!("Abrindo {}", host_of(field("url"))),
        "WebSearch" => format!("Pesquisando \"{}\"", field("query")),
        "Agent" | "Task" => {
            let what = [field("description"), field("subagent_type")].into_iter().find(|s| !s.is_empty()).unwrap_or("subagente");
            format!("Delegando: {what}")
        }
        "Skill" => format!("Skill {}", field("skill")),
        "AskUserQuestion" => "Fazendo uma pergunta".to_string(),
        "ExitPlanMode" => "Plano pronto para revisar".to_string(),
        "TodoWrite" | "TaskCreate" | "TaskUpdate" => "Organizando tarefas".to_string(),
        "ToolSearch" => "Carregando ferramentas".to_string(),
        _ => describe_mcp_tool(name).unwrap_or_else(|| name.to_string()),
    };
    clip(&label, LABEL_MAX)
}

fn describe_mcp_tool(name: &str) -> Option<String> {
    let rest = name.strip_prefix("mcp__")?;
    let (server, tool) = rest.split_once("__").unwrap_or((rest, ""));
    let server = server.strip_prefix("claude_ai_").unwrap_or(server).replace('_', " ");
    Some(format!("{server}: {tool}"))
}

fn host_of(url: &str) -> String {
    let without_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = without_scheme.split(['/', '?', '#', ':']).next().unwrap_or_default();
    if host.is_empty() { "página".to_string() } else { host.to_string() }
}

pub fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut clipped: String = flat.chars().take(max - 1).collect();
    clipped.push('…');
    clipped
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(value: Value) -> Vec<u8> {
        let mut bytes = serde_json::to_vec(&value).unwrap();
        bytes.push(b'\n');
        bytes
    }

    fn tool_use(id: &str, name: &str, input: Value, ts: &str) -> Value {
        json!({"type": "assistant", "timestamp": ts, "message": {"model": "claude-opus-5-5",
            "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}})
    }

    fn tool_result(id: &str) -> Value {
        json!({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": id}]}})
    }

    #[test]
    fn line_split_across_reads_inside_multibyte_char_is_reassembled() {
        let mut tracker = TranscriptTracker::new(PathBuf::from("/nonexistent"));
        let bytes = line(json!({"type": "ai-title", "aiTitle": "Ação jurídica"}));
        let split = bytes.iter().position(|&b| b == 0xc3).unwrap() + 1; // middle of "ç"
        tracker.consume(&bytes[..split]);
        assert_eq!(tracker.state.title, None);
        tracker.consume(&bytes[split..]);
        assert_eq!(tracker.state.title.as_deref(), Some("Ação jurídica"));
    }

    #[test]
    fn pending_tool_is_the_activity_until_its_result_arrives() {
        let mut state = TranscriptState::default();
        state.apply_entry(&tool_use("t1", "Read", json!({"file_path": "/a/b/server.rs"}), "2026-09-30T10:00:00.000Z"));
        state.apply_entry(&tool_use("t2", "Bash", json!({"command": "ls", "description": "Lista arquivos"}), "2026-09-30T10:00:05.000Z"));
        let now = parse_timestamp_ms("2026-09-30T10:00:06.000Z").unwrap();

        let latest = state.latest_pending_tool(now).unwrap();
        assert_eq!(describe_tool(&latest.name, &latest.input), "$ Lista arquivos");
        state.apply_entry(&json!({"type": "assistant", "message": {"content": [{"type": "text", "text": "Pronto.\n\nQuer que eu  publique?"}]}}));
        assert_eq!(state.last_reply.as_deref(), Some("Pronto. Quer que eu publique?"));

        state.apply_entry(&tool_result("t2"));
        let latest = state.latest_pending_tool(now).unwrap();
        assert_eq!(describe_tool(&latest.name, &latest.input), "Lendo server.rs");
        assert_eq!(state.last_kind, Some(LastKind::ToolResult));
        assert_eq!(state.last_prompt_at, None, "tool results are not prompts");
    }

    #[test]
    fn new_prompt_drops_tools_left_pending_by_an_interrupted_turn() {
        let mut state = TranscriptState::default();
        state.apply_entry(&tool_use("t1", "Bash", json!({"command": "sleep 100"}), "2026-09-30T10:00:00.000Z"));
        state.apply_entry(&json!({"type": "user", "timestamp": "2026-09-30T10:00:09.000Z", "message": {"content": "outra coisa"}}));
        assert!(state.pending.is_empty());
        assert_eq!(state.last_kind, Some(LastKind::Prompt));
        assert_eq!(state.last_prompt_at, parse_timestamp_ms("2026-09-30T10:00:09.000Z"));
    }

    #[test]
    fn meta_user_entries_do_not_look_like_prompts() {
        let mut state = TranscriptState::default();
        state.apply_entry(&tool_use("t1", "Grep", json!({"pattern": "x"}), "2026-09-30T10:00:00.000Z"));
        state.apply_entry(&json!({"type": "user", "isMeta": true, "message": {"content": "injected"}}));
        assert_eq!(state.pending.len(), 1);
    }

    #[test]
    fn timeline_restarts_each_turn_and_edited_files_keep_one_entry_each() {
        let mut state = TranscriptState::default();
        state.apply_entry(&tool_use("t1", "Read", json!({"file_path": "/r/a.rs"}), "2026-09-30T10:00:00.000Z"));
        state.apply_entry(&tool_use("t2", "Edit", json!({"file_path": "/r/a.rs"}), "2026-09-30T10:00:01.000Z"));
        state.apply_entry(&tool_use("t3", "Bash", json!({"command": "cargo test"}), "2026-09-30T10:00:02.000Z"));
        let kinds: Vec<_> = state.steps.iter().map(|s| s.kind).collect();
        assert_eq!(kinds, ["reading", "coding", "terminal"]);

        state.apply_entry(&json!({"type": "user", "message": {"content": "agora o b"}}));
        assert!(state.steps.is_empty(), "a new prompt starts a new timeline");
        state.apply_entry(&tool_use("t4", "Write", json!({"file_path": "/r/b.rs"}), "2026-09-30T10:01:00.000Z"));
        state.apply_entry(&tool_use("t5", "Edit", json!({"file_path": "/r/a.rs"}), "2026-09-30T10:02:00.000Z"));
        let files: Vec<_> = state.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(files, ["/r/b.rs", "/r/a.rs"], "edits survive turns; a re-edit moves the file to the end");
    }

    #[test]
    fn stale_pending_tools_are_ignored() {
        let mut state = TranscriptState::default();
        state.apply_entry(&tool_use("t1", "Bash", json!({}), "2026-09-30T10:00:00.000Z"));
        let an_hour_later = parse_timestamp_ms("2026-09-30T11:00:00.000Z").unwrap();
        assert!(state.latest_pending_tool(an_hour_later).is_none());
    }

    #[test]
    fn title_and_prompt_are_found_outside_the_bootstrap_tail() {
        let dir = std::env::temp_dir().join(format!("cpo-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        let mut bytes = line(json!({"type": "ai-title", "aiTitle": "Título antigo"}));
        bytes.extend(line(json!({"type": "last-prompt", "lastPrompt": "faça X"})));
        let filler = line(json!({"type": "attachment", "pad": "x".repeat(1000)}));
        while bytes.len() < BOOTSTRAP_TAIL_BYTES * 2 {
            bytes.extend_from_slice(&filler);
        }
        bytes.extend(line(tool_use("t1", "WebFetch", json!({"url": "https://docs.rs/tauri"}), "2026-09-30T10:00:00.000Z")));
        fs::write(&path, &bytes).unwrap();

        let mut tracker = TranscriptTracker::new(path);
        let state = tracker.refresh();
        assert_eq!(state.title.as_deref(), Some("Título antigo"));
        assert_eq!(state.last_prompt.as_deref(), Some("faça X"));
        let tool = state.pending.get("t1").unwrap();
        assert_eq!(describe_tool(&tool.name, &tool.input), "Abrindo docs.rs");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn git_action_finds_pushes_and_merges_but_not_their_mentions() {
        assert_eq!(git_action("git push -u origin feature-x"), Some("push"));
        assert_eq!(git_action("cd /r && git -C sub -c core.x=1 push"), Some("push"));
        assert_eq!(git_action("git checkout main && git merge feature-x && git push"), Some("push"));
        assert_eq!(git_action("git merge --no-ff feature-x"), Some("merge"));
        assert_eq!(git_action("gh pr merge 42 --squash"), Some("merge"));
        assert_eq!(git_action("GIT_SSH_COMMAND='ssh -i k' /usr/bin/git push"), Some("push"));
        assert_eq!(git_action("git push --dry-run"), None);
        assert_eq!(git_action("git merge --abort"), None);
        assert_eq!(git_action("git merge-base main HEAD"), None);
        assert_eq!(git_action(r#"git commit -m "fix; git push later" && echo \"git merge\""#), None);
        assert_eq!(git_action("echo git push"), None);
    }

    #[test]
    fn git_and_gh_calls_are_git_work_but_their_mentions_are_not() {
        let bash = |command: &str| step_kind("Bash", &json!({ "command": command }));
        assert_eq!(bash("git status"), "git");
        assert_eq!(bash("cd /r && git -C sub log --oneline | head"), "git");
        assert_eq!(bash("GIT_PAGER=cat /usr/bin/git diff"), "git");
        assert_eq!(bash("gh pr create --fill"), "git");
        assert_eq!(bash("cargo test"), "terminal");
        assert_eq!(bash(r#"echo "git push" && grep -r git src"#), "terminal");
        assert_eq!(step_kind("Read", &json!({"file_path": "/r/.gitignore"})), "reading");
    }

    #[test]
    fn branch_follows_the_latest_entry_that_names_one() {
        let mut state = TranscriptState::default();
        state.apply_entry(&json!({"type": "user", "gitBranch": "main", "message": {"content": "oi"}}));
        state.apply_entry(&json!({"type": "assistant", "gitBranch": "feature-x", "message": {"content": []}}));
        state.apply_entry(&json!({"type": "assistant", "gitBranch": "", "message": {"content": []}}));
        assert_eq!(state.branch.as_deref(), Some("feature-x"), "outside a repo the last branch stays");
    }

    #[test]
    fn only_a_push_that_went_through_is_recorded() {
        let mut state = TranscriptState::default();
        state.apply_entry(&tool_use("t1", "Bash", json!({"command": "git push origin main"}), "2026-09-30T10:00:00.000Z"));
        state.apply_entry(&json!({"type": "user", "timestamp": "2026-09-30T10:00:02.000Z",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "is_error": true}]}}));
        assert_eq!(state.git, None, "a rejected push is no news");

        state.apply_entry(&tool_use("t2", "Bash", json!({"command": "git merge feature-x"}), "2026-09-30T10:01:00.000Z"));
        state.apply_entry(&json!({"type": "user", "timestamp": "2026-09-30T10:01:03.000Z",
            "message": {"content": [{"type": "tool_result", "tool_use_id": "t2"}]}}));
        assert_eq!(state.git, Some(GitEvent { kind: "merge", at: parse_timestamp_ms("2026-09-30T10:01:03.000Z") }));
    }

    #[test]
    fn mcp_tools_show_server_and_tool() {
        assert_eq!(describe_tool("mcp__claude_ai_Google_Drive__search_files", &json!({})), "Google Drive: search_files");
    }

    #[test]
    fn timestamps_parse_to_epoch_millis() {
        assert_eq!(parse_timestamp_ms("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(parse_timestamp_ms("2026-09-30T16:23:22.576Z"), Some(1_790_785_402_576));
    }

    #[test]
    fn clip_collapses_whitespace_and_marks_truncation() {
        assert_eq!(clip("a  b\n c", 10), "a b c");
        assert_eq!(clip("abcdefghij", 5), "abcd…");
    }
}
