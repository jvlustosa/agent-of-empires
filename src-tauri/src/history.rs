//! Past Claude Code sessions of a repository, newest first: the base's "Histórico de sessões".
//!
//! Title and last prompt come from the end of each transcript (Claude Code rewrites them as the
//! session goes). The folder it started in comes from the first entry: later ones follow the shell's `cd`.

use crate::collector::project_slug;
use crate::empire::repo_for_slug;
use crate::projects::Project;
use crate::transcript::{clip, mtime_ms, non_empty_str, parse_line, LABEL_MAX, PROMPT_MARKER, TITLE_MARKER};
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const HISTORY_MAX: usize = 20;
// A whole transcript is read only when its head or tail lacks a field.
const HEAD_BYTES: u64 = 64 * 1024;
const TAIL_BYTES: u64 = 256 * 1024;
const PROMPT_MAX: usize = 120;
const CWD_MARKER: &[u8] = br#""cwd":""#;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastSession {
    pub id: String,
    pub title: String,
    pub last_prompt: Option<String>,
    /// Folder the session started in: `claude --resume` only finds it from there.
    pub cwd: String,
    pub updated_at: i64,
}

/// `root` is Claude Code's projects folder (`~/.claude/projects`).
pub fn list_sessions(root: &Path, repo: &Project, repos: &[Project]) -> Vec<PastSession> {
    let mut transcripts = transcripts_of(root, repo, repos);
    transcripts.sort_by(|a, b| b.1.cmp(&a.1));
    transcripts
        .into_iter()
        .filter_map(|(path, updated_at)| read_session(&path, updated_at, Path::new(&repo.path)))
        .take(HISTORY_MAX)
        .collect()
}

/// The session to resume, found again on disk: the UI only names it.
pub fn find_session(root: &Path, repo: &Project, repos: &[Project], session_id: &str) -> Option<PastSession> {
    if session_id.is_empty() || !session_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }
    transcripts_of(root, repo, repos)
        .into_iter()
        .find(|(path, _)| path.file_stem().is_some_and(|stem| stem == session_id))
        .and_then(|(path, updated_at)| read_session(&path, updated_at, Path::new(&repo.path)))
}

// Sessions started in a subfolder (src-tauri) belong to the repository, unless a deeper repository owns it.
fn transcripts_of(root: &Path, repo: &Project, repos: &[Project]) -> Vec<(PathBuf, i64)> {
    let Ok(dirs) = fs::read_dir(root) else { return Vec::new() };
    let slugs: Vec<(String, &Project)> = repos.iter().map(|project| (project_slug(&project.path), project)).collect();
    dirs.flatten()
        .filter(|dir| repo_for_slug(&dir.file_name().to_string_lossy(), &slugs).is_some_and(|owner| owner.path == repo.path))
        .filter_map(|dir| fs::read_dir(dir.path()).ok())
        .flat_map(|files| files.flatten())
        .filter_map(|file| {
            let path = file.path();
            let meta = file.metadata().ok()?;
            let is_transcript = meta.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl");
            is_transcript.then(|| (path, mtime_ms(&meta)))
        })
        .collect()
}

fn read_session(path: &Path, updated_at: i64, repo: &Path) -> Option<PastSession> {
    let id = path.file_stem()?.to_str()?.to_string();
    let cwd = launch_cwd(path)?;
    // The transcript must sit under that folder's slug (where `--resume` looks), and since "a-b" and
    // "a/b" share a slug, the folder must also be inside the repository.
    let folder = path.parent()?.file_name()?.to_str()?;
    if project_slug(&cwd) != folder || !Path::new(&cwd).starts_with(repo) {
        return None;
    }
    let (tail, is_whole) = read_tail(path, TAIL_BYTES).ok()?;
    let mut found = Found::scan(&tail);
    if !found.is_complete() && !is_whole {
        found = Found::scan(&fs::read(path).ok()?);
    }
    let title = found.title.or_else(|| found.prompt.clone())?; // nothing was ever asked: nothing to resume
    Some(PastSession { id, title: clip(&title, LABEL_MAX), last_prompt: found.prompt.map(|p| clip(&p, PROMPT_MAX)), cwd, updated_at })
}

fn launch_cwd(path: &Path) -> Option<String> {
    let mut head = Vec::new();
    File::open(path).ok()?.take(HEAD_BYTES).read_to_end(&mut head).ok()?;
    first_cwd(&head).or_else(|| first_cwd(&fs::read(path).ok()?))
}

// Only an entry's own field: a hook payload can nest a cwd of its own.
pub(crate) fn first_cwd(buf: &[u8]) -> Option<String> {
    buf.split(|&b| b == b'\n').filter(|line| contains(line, CWD_MARKER)).find_map(|line| top_level_str(line, "cwd"))
}

fn read_tail(path: &Path, max: u64) -> std::io::Result<(Vec<u8>, bool)> {
    let mut file = File::open(path)?;
    let start = file.metadata()?.len().saturating_sub(max);
    file.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok((buf, start == 0))
}

#[derive(Default)]
struct Found {
    title: Option<String>,
    prompt: Option<String>,
}

impl Found {
    // Newest line first, so each field keeps the last value written; a cut first line fails to parse and is skipped.
    fn scan(buf: &[u8]) -> Self {
        let mut found = Self::default();
        for line in buf.rsplit(|&b| b == b'\n') {
            if found.title.is_none() && contains(line, TITLE_MARKER) {
                found.title = top_level_str(line, "aiTitle");
            }
            if found.prompt.is_none() && contains(line, PROMPT_MARKER) {
                found.prompt = top_level_str(line, "lastPrompt");
            }
            if found.is_complete() {
                break;
            }
        }
        found
    }

    fn is_complete(&self) -> bool {
        self.title.is_some() && self.prompt.is_some()
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn top_level_str(line: &[u8], key: &str) -> Option<String> {
    non_empty_str(parse_line(line)?.get(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_title_and_prompt_win_and_cwd_is_where_it_started() {
        let text = concat!(
            r#"{"type":"attachment","attachment":{"cwd":"/tmp/hook"},"cwd":"/home/u/Code/repo"}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Primeiro título"}"#,
            "\n",
            r#"{"type":"last-prompt","lastPrompt":"corrigir o login"}"#,
            "\n",
            r#"{"type":"ai-title","aiTitle":"Corrigir login"}"#,
            "\n",
            r#"{"type":"user","cwd":"/tmp/scratchpad"}"#, // the shell moved; the session did not
            "\n",
        );
        let found = Found::scan(text.as_bytes());
        assert_eq!(found.title.as_deref(), Some("Corrigir login"));
        assert_eq!(found.prompt.as_deref(), Some("corrigir o login"));
        assert_eq!(first_cwd(text.as_bytes()).as_deref(), Some("/home/u/Code/repo"));
    }

    #[test]
    fn sessions_list_newest_first_and_skip_other_folders_and_empty_ones() {
        let dir = std::env::temp_dir().join(format!("cpo-history-{}", std::process::id()));
        let repo_path = dir.join("Code").join("repo");
        let cwd = repo_path.join("src-tauri").to_string_lossy().into_owned(); // a subfolder counts for the repository
        let root = dir.join("projects");
        let transcripts = root.join(project_slug(&cwd));
        fs::create_dir_all(&transcripts).unwrap();
        let session = |title: &str| format!("{{\"type\":\"user\",\"cwd\":\"{cwd}\"}}\n{{\"type\":\"last-prompt\",\"lastPrompt\":\"{title}\"}}\n");
        fs::write(transcripts.join("aaaa-1.jsonl"), session("antiga")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(transcripts.join("bbbb-2.jsonl"), session("recente")).unwrap();
        fs::write(transcripts.join("cccc-3.jsonl"), format!("{{\"type\":\"user\",\"cwd\":\"{cwd}\"}}\n")).unwrap();
        fs::write(transcripts.join("dddd-4.jsonl"), "{\"type\":\"user\",\"cwd\":\"/somewhere/else\"}\n{\"type\":\"last-prompt\",\"lastPrompt\":\"x\"}\n").unwrap();

        let repo = Project { name: "repo".into(), path: repo_path.to_string_lossy().into_owned(), parent: "Code".into(), last_claude_at: None, last_git_at: None, tracked_files: None };
        let repos = std::slice::from_ref(&repo);
        let sessions = list_sessions(&root, &repo, repos);
        let found = find_session(&root, &repo, repos, "aaaa-1");
        let rejected = find_session(&root, &repo, repos, "../aaaa-1");
        fs::remove_dir_all(&dir).unwrap();

        let titles: Vec<&str> = sessions.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["recente", "antiga"]);
        assert_eq!(sessions[0].cwd, cwd);
        assert_eq!(found.map(|s| s.title), Some("antiga".to_string()));
        assert!(rejected.is_none());
    }

    #[test]
    #[ignore = "reads this machine's ~/Code and ~/.claude; run with --ignored --nocapture"]
    fn live_history_smoke() {
        let root = crate::projects::claude_projects_dir().unwrap();
        let repos = crate::projects::list_projects();
        let repo = repos.iter().find(|p| p.name == "agent-of-empires").unwrap();
        let started = std::time::Instant::now();
        let sessions = list_sessions(&root, repo, &repos);
        println!("{} sessions in {:?}", sessions.len(), started.elapsed());
        for session in &sessions {
            println!("{} · {} · {:?}", session.id, session.title, session.last_prompt);
        }
        assert!(!sessions.is_empty());
    }
}
