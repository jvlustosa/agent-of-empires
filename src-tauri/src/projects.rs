//! Git repositories under the projects folder (~/Code unless chosen at first run) that a new agent
//! can be deployed to.

use crate::collector::project_slug;
use crate::empire::git;
use crate::transcript::mtime_ms;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

// Folders that hold repos rather than being one (e.g. ~/Code/Trabalho) are scanned
// one level deeper; nothing below that, so the list stays fast and free of vendored checkouts.
const MAX_DEPTH: usize = 2;
const SKIPPED_DIRS: [&str; 3] = ["node_modules", "target", "vendor"];

const README_NAMES: [&str; 4] = ["README.md", "readme.md", "Readme.md", "README"];
const README_MAX_BYTES: u64 = 16 * 1024; // the first paragraph is near the top
const SUMMARY_MAX_CHARS: usize = 280;
const STACK_MAX: usize = 5;
// Files or folders at the root and what they say the repository is built with.
const STACK_FILES: [(&str, &str); 10] = [
    ("Cargo.toml", "Rust"),
    ("src-tauri", "Tauri"),
    ("pyproject.toml", "Python"),
    ("requirements.txt", "Python"),
    ("go.mod", "Go"),
    ("_config.yml", "Jekyll"),
    ("Gemfile", "Ruby"),
    ("serverless.yml", "Serverless"),
    ("supabase", "Supabase"),
    ("platformio.ini", "PlatformIO"),
];
// package.json dependencies worth naming; a package.json with none of them reads as plain Node.
const PACKAGE_STACKS: [(&str, &str); 8] = [
    ("next", "Next.js"),
    ("react", "React"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("astro", "Astro"),
    ("vite", "Vite"),
    ("express", "Express"),
    ("typescript", "TypeScript"),
];

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

/// What the "Novo agente" gallery shows of the chosen repository, read when it is chosen.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// The README's first paragraph as plain text, else the manifest's description.
    pub summary: Option<String>,
    /// What it is built with, from the manifests at its root.
    pub stack: Vec<&'static str>,
    pub branch: Option<String>,
    /// Subject of the commit HEAD points to, and when it was made.
    pub last_commit: Option<String>,
    pub last_commit_at: Option<i64>,
    /// Files changed, staged or new since that commit.
    pub changes: Option<u32>,
}

pub fn preview(repo: &Path) -> Preview {
    let package = fs::read_to_string(repo.join("package.json")).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let summary = read_readme(repo).and_then(|text| readme_summary(&text)).or_else(|| manifest_description(repo, package.as_ref()));
    let last = git(repo, &["log", "-1", "--format=%ct%x00%s"]);
    let (seconds, subject) = last.as_deref().and_then(|line| line.trim_end().split_once('\0')).unzip();
    Preview {
        summary: summary.map(|text| truncate(&text, SUMMARY_MAX_CHARS)),
        stack: stack(repo, package.as_ref()),
        branch: branch(repo),
        last_commit: subject.map(String::from),
        last_commit_at: seconds.and_then(|s| s.parse::<i64>().ok()).map(|s| s * 1000),
        changes: git(repo, &["status", "--porcelain"]).map(|out| out.lines().count() as u32),
    }
}

fn read_readme(repo: &Path) -> Option<String> {
    let file = README_NAMES.iter().find_map(|name| fs::File::open(repo.join(name)).ok())?;
    let mut bytes = Vec::new();
    file.take(README_MAX_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The first paragraph of prose: past the title, badges, images, HTML, lists, tables and code.
fn readme_summary(text: &str) -> Option<String> {
    let mut paragraph: Vec<String> = Vec::new();
    let mut is_code = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with("```") || line.starts_with("~~~") {
            is_code = !is_code;
            continue;
        }
        // "===" or "---" under a line makes it a title; alone it is a rule (or front matter's fence).
        if !line.is_empty() && (line.chars().all(|c| c == '=') || line.chars().all(|c| c == '-')) {
            paragraph.clear();
            continue;
        }
        let is_list = ["- ", "* ", "+ "].iter().any(|marker| line.starts_with(marker)) || line.split_once(". ").is_some_and(|(n, _)| n.parse::<u32>().is_ok());
        let is_skipped = is_code || is_list || line.starts_with(['#', '|', '<']);
        let prose = if is_skipped { String::new() } else { plain_text(line.trim_start_matches('>').trim()) };
        if prose.is_empty() {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        paragraph.push(prose);
    }
    (!paragraph.is_empty()).then(|| paragraph.join(" "))
}

// Markdown to the words it shows: images and tags dropped, links reduced to their text.
fn plain_text(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(start) = rest.find(['!', '[', '<', '`', '*']) {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let is_tag = rest[1..].starts_with(|c: char| c.is_ascii_alphabetic() || c == '/' || c == '!');
        if let Some((_, after)) = rest.strip_prefix("![").and_then(split_link) {
            rest = after; // an image
        } else if let Some((text, after)) = rest.strip_prefix('[').and_then(split_link) {
            out.push_str(&plain_text(text));
            rest = after;
        } else if let Some((_, after)) = rest.strip_prefix('<').filter(|_| is_tag).and_then(|r| r.split_once('>')) {
            rest = after;
        } else if rest.starts_with(['`', '*']) {
            rest = &rest[1..];
        } else {
            out.push_str(&rest[..1]);
            rest = &rest[1..];
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// "text](url)rest" after a link's "[": its text and what follows. The text may hold brackets, as a
// badge's does: "[![alt](img)](link)".
fn split_link(rest: &str) -> Option<(&str, &str)> {
    let mut depth = 0;
    for (index, c) in rest.char_indices() {
        match c {
            '[' => depth += 1,
            ']' if depth > 0 => depth -= 1,
            ']' => {
                let url = rest[index + 1..].strip_prefix('(')?;
                return Some((&rest[..index], url.split_once(')')?.1));
            }
            _ => {}
        }
    }
    None
}

fn manifest_description(repo: &Path, package: Option<&Value>) -> Option<String> {
    let from_package = package.and_then(|p| p.get("description")?.as_str()).map(str::trim).filter(|d| !d.is_empty()).map(String::from);
    from_package.or_else(|| {
        ["Cargo.toml", "pyproject.toml"].iter().find_map(|file| {
            let text = fs::read_to_string(repo.join(file)).ok()?;
            text.lines().find_map(|line| {
                let value = line.trim().strip_prefix("description")?.trim_start().strip_prefix('=')?.trim();
                value.strip_prefix('"')?.strip_suffix('"').filter(|d| !d.is_empty()).map(String::from)
            })
        })
    })
}

fn stack(repo: &Path, package: Option<&Value>) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = Vec::new();
    if let Some(package) = package {
        let has_dep = |name: &str| ["dependencies", "devDependencies"].iter().any(|key| package.get(key).and_then(|deps| deps.get(name)).is_some());
        found.extend(PACKAGE_STACKS.iter().filter(|(dep, _)| has_dep(dep)).map(|(_, label)| *label));
        if found.is_empty() {
            found.push("Node");
        }
    }
    for (file, label) in STACK_FILES {
        if repo.join(file).exists() && !found.contains(&label) {
            found.push(label);
        }
    }
    found.truncate(STACK_MAX);
    found
}

// HEAD names the branch ("ref: refs/heads/main"); detached, it holds the commit itself.
fn branch(repo: &Path) -> Option<String> {
    let head = fs::read_to_string(git_dir(repo)?.join("HEAD")).ok()?;
    let head = head.trim();
    Some(head.strip_prefix("ref: refs/heads/").map(String::from).unwrap_or_else(|| head.chars().take(7).collect()))
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    format!("{}…", cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head).trim_end_matches([',', ';', ':']))
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
    fn readme_summary_is_the_first_prose_paragraph_as_plain_text() {
        let readme = "---\nlayout: x\n---\n<p align=\"center\"><img src=\"logo.png\"></p>\n\n# Shop\n\n\
            [![CI](https://ci/badge.svg)](https://ci) ![logo](a.png)\n\n\
            **Shop** sells [things](https://x.y) on `WhatsApp`,\nfast.\n\nSecond paragraph.";
        assert_eq!(readme_summary(readme).as_deref(), Some("Shop sells things on WhatsApp, fast."));

        let setext = "Title\n=====\n\n> A tagline <br> here\n\n- not this";
        assert_eq!(readme_summary(setext).as_deref(), Some("A tagline here"));
        assert_eq!(readme_summary("# Only a title\n\n```\ncode\n```\n- a list\n1. steps"), None);
        assert_eq!(plain_text("a < b and [WIP] stays"), "a < b and [WIP] stays");
    }

    #[test]
    fn long_summaries_end_on_a_word() {
        assert_eq!(truncate("one two three", 9), "one two…");
        assert_eq!(truncate("short", 9), "short");
    }

    #[test]
    fn branch_comes_from_head_or_the_detached_commit() {
        let root = std::env::temp_dir().join(format!("cpo-branch-{}", std::process::id()));
        fs::create_dir_all(root.join("on/.git")).unwrap();
        fs::create_dir_all(root.join("off/.git")).unwrap();
        fs::write(root.join("on/.git/HEAD"), "ref: refs/heads/feature-x\n").unwrap();
        fs::write(root.join("off/.git/HEAD"), "67164ab0123456789\n").unwrap();
        assert_eq!(branch(&root.join("on")).as_deref(), Some("feature-x"));
        assert_eq!(branch(&root.join("off")).as_deref(), Some("67164ab"));
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
