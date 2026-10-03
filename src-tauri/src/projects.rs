//! Git repositories under the projects folder (~/Code unless chosen at first run) that a new agent
//! can be deployed to.

use crate::collector::project_slug;
use crate::transcript::mtime_ms;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

// Folders that hold repos rather than being one (e.g. ~/Code/Trabalho) are scanned
// one level deeper; nothing below that, so the list stays fast and free of vendored checkouts.
const MAX_DEPTH: usize = 2;
const SKIPPED_DIRS: [&str; 3] = ["node_modules", "target", "vendor"];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub path: String,
    pub parent: String,
    /// Newest write to a Claude Code transcript of this folder: the last time an agent worked here.
    pub last_claude_at: Option<i64>,
    /// When HEAD last moved (commit, checkout, pull), from the reflog's mtime.
    pub last_git_at: Option<i64>,
    /// Files git tracks: the map suggests how big the repository's town center is from it.
    pub tracked_files: Option<u32>,
}

impl Project {
    fn last_active_at(&self) -> Option<i64> {
        self.last_claude_at.max(self.last_git_at)
    }
}

pub(crate) fn projects_root() -> Option<PathBuf> {
    std::env::var_os("CPO_PROJECTS_ROOT")
        .map(PathBuf::from)
        .or_else(|| crate::onboarding::Config::load().projects_root.map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Code")))
}

pub(crate) fn claude_config_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
}

pub(crate) fn claude_projects_dir() -> Option<PathBuf> {
    claude_config_dir().map(|dir| dir.join("projects"))
}

fn collect_repos(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_str()) || !path.is_dir() {
            continue;
        }
        if path.join(".git").exists() {
            found.push(path);
        } else if depth < MAX_DEPTH {
            collect_repos(&path, depth + 1, found);
        }
    }
}

fn newest_transcript_ms(dir: &Path) -> Option<i64> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .filter_map(|entry| entry.metadata().ok().map(|meta| mtime_ms(&meta)))
        .max()
}

// Worktrees and submodules have a `.git` file pointing at the real git dir.
fn git_dir(repo: &Path) -> Option<PathBuf> {
    let dot_git = repo.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    let pointer = fs::read_to_string(&dot_git).ok()?;
    let target = PathBuf::from(pointer.strip_prefix("gitdir:")?.trim());
    Some(if target.is_absolute() { target } else { repo.join(target) })
}

fn last_git_ms(repo: &Path) -> Option<i64> {
    fs::metadata(git_dir(repo)?.join("logs").join("HEAD")).ok().map(|meta| mtime_ms(&meta))
}

// The index header is "DIRC", a version and the entry count (big-endian): 12 bytes, no git run.
fn tracked_files(repo: &Path) -> Option<u32> {
    use std::io::Read;
    let mut header = [0u8; 12];
    fs::File::open(git_dir(repo)?.join("index")).ok()?.read_exact(&mut header).ok()?;
    if &header[..4] != b"DIRC" {
        return None;
    }
    Some(u32::from_be_bytes([header[8], header[9], header[10], header[11]]))
}

/// Most recently worked on first (Claude or git, whichever is newer), then alphabetical.
pub fn list_projects() -> Vec<Project> {
    let Some(root) = projects_root() else { return Vec::new() };
    let mut repos = Vec::new();
    collect_repos(&root, 1, &mut repos);
    let claude_dir = claude_projects_dir();

    let mut projects: Vec<Project> = repos
        .into_iter()
        .map(|path| {
            let path_text = path.to_string_lossy().into_owned();
            let last_claude_at = claude_dir.as_ref().and_then(|dir| newest_transcript_ms(&dir.join(project_slug(&path_text))));
            Project {
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                parent: path.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                last_git_at: last_git_ms(&path),
                tracked_files: tracked_files(&path),
                path: path_text,
                last_claude_at,
            }
        })
        .collect();
    sort_by_recency(&mut projects);
    projects
}

fn sort_by_recency(projects: &mut [Project]) {
    projects.sort_by(|a, b| b.last_active_at().cmp(&a.last_active_at()).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_repos_directly_and_inside_grouping_folders_but_not_deeper() {
        let root = std::env::temp_dir().join(format!("cpo-projects-{}", std::process::id()));
        for repo in ["site/.git", "Base/api/.git", "Base/node_modules/pkg/.git", "Base/deep/er/repo/.git", ".hidden/.git"] {
            fs::create_dir_all(root.join(repo)).unwrap();
        }
        let mut found = Vec::new();
        collect_repos(&root, 1, &mut found);
        let mut names: Vec<_> = found.iter().map(|p| p.strip_prefix(&root).unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["Base/api", "site"]);
        fs::remove_dir_all(root).unwrap();
    }

    fn project(name: &str, last_claude_at: Option<i64>, last_git_at: Option<i64>) -> Project {
        Project { name: name.into(), path: String::new(), parent: String::new(), last_claude_at, last_git_at, tracked_files: None }
    }

    #[test]
    fn newest_claude_or_git_activity_comes_first_then_names() {
        let mut projects = vec![
            project("zeta", None, None),
            project("old-claude", Some(100), None),
            project("fresh-commit", Some(50), Some(300)),
            project("fresh-claude", Some(200), Some(10)),
            project("Alpha", None, None),
        ];
        sort_by_recency(&mut projects);
        let names: Vec<_> = projects.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["fresh-commit", "fresh-claude", "old-claude", "Alpha", "zeta"]);
    }

    #[test]
    fn git_activity_is_read_through_worktree_pointers() {
        let root = std::env::temp_dir().join(format!("cpo-gitdir-{}", std::process::id()));
        let real = root.join("main/.git/worktrees/wt");
        fs::create_dir_all(real.join("logs")).unwrap();
        fs::write(real.join("logs/HEAD"), "").unwrap();
        fs::create_dir_all(root.join("wt")).unwrap();
        fs::write(root.join("wt/.git"), format!("gitdir: {}\n", real.display())).unwrap();
        fs::create_dir_all(root.join("fresh/.git")).unwrap(); // no commits yet: no reflog

        assert!(last_git_ms(&root.join("wt")).is_some());
        assert_eq!(last_git_ms(&root.join("fresh")), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tracked_files_come_from_the_index_header() {
        let root = std::env::temp_dir().join(format!("cpo-index-{}", std::process::id()));
        fs::create_dir_all(root.join("repo/.git")).unwrap();
        fs::create_dir_all(root.join("bad/.git")).unwrap();
        fs::create_dir_all(root.join("empty/.git")).unwrap();
        let mut index = b"DIRC".to_vec();
        index.extend_from_slice(&2u32.to_be_bytes());
        index.extend_from_slice(&4619u32.to_be_bytes());
        fs::write(root.join("repo/.git/index"), index).unwrap();
        fs::write(root.join("bad/.git/index"), b"garbage-garbage").unwrap();

        assert_eq!(tracked_files(&root.join("repo")), Some(4619));
        assert_eq!(tracked_files(&root.join("bad")), None);
        assert_eq!(tracked_files(&root.join("empty")), None); // no commits, nothing staged
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn claude_activity_is_the_newest_transcript_not_the_folder() {
        let dir = std::env::temp_dir().join(format!("cpo-transcripts-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(newest_transcript_ms(&dir), None);
        fs::write(dir.join("a.jsonl"), "{}").unwrap();
        fs::write(dir.join("notes.txt"), "").unwrap();
        let newest = newest_transcript_ms(&dir).unwrap();
        assert_eq!(newest, mtime_ms(&fs::metadata(dir.join("a.jsonl")).unwrap()));
        fs::remove_dir_all(dir).unwrap();
    }
}
