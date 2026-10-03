//! Opens a new terminal window in a project with `claude` already running the task.
//!
//! Everything goes as argv, never through a shell, so nothing in the task can run as a command,
//! and `--` keeps a task that starts with "-" from being read as a claude flag.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const DIR: &str = "{dir}";
// (binary, arguments before the command). Tried in this order after $TERMINAL: the freedesktop
// launcher, kitty (installing it is a deliberate choice), the KDE and GNOME defaults, then the rest.
// Each one hands everything after its command flag to claude untouched, including our "--".
const TERMINALS: &[(&str, &[&str])] = &[
    ("xdg-terminal-exec", &[]),
    ("kitty", &["--directory", DIR]),
    ("konsole", &["--workdir", DIR, "-e"]),
    ("gnome-terminal", &["--working-directory={dir}", "--"]),
    ("ptyxis", &["--new-window", "--working-directory={dir}", "--"]),
    ("kgx", &["--working-directory={dir}", "--"]),
    ("alacritty", &["--working-directory", DIR, "-e"]),
    ("wezterm", &["start", "--cwd", DIR, "--"]),
    ("foot", &["--working-directory={dir}"]),
    ("xterm", &["-e"]),
];
// An unknown $TERMINAL gets the flag most emulators share; its cwd is set on the process.
const GENERIC_ARGS: &[&str] = &["-e"];

#[derive(Debug, PartialEq, Eq)]
struct Terminal {
    program: PathBuf,
    name: String,
    args: &'static [&'static str],
}

/// Starts `claude` (with `task` as its first prompt, if any) in a new terminal window at `project`.
/// Returns the terminal's name for the confirmation message.
pub fn launch_claude(claude: &Path, project: &Path, task: &str) -> Result<String, String> {
    launch(claude, project, task_args(task))
}

/// Reopens a past session (`claude --resume <id>`) in a new terminal window at the folder it ran in.
pub fn resume_claude(claude: &Path, cwd: &Path, session_id: &str) -> Result<String, String> {
    launch(claude, cwd, vec!["--resume".into(), session_id.into()])
}

fn launch(claude: &Path, project: &Path, claude_args: Vec<OsString>) -> Result<String, String> {
    let terminal = pick_terminal(std::env::var_os("TERMINAL"), std::env::var_os("PATH"))
        .ok_or("Não achei um terminal: defina TERMINAL ou instale kitty, gnome-terminal, konsole ou alacritty")?;
    spawn_in(&terminal, claude, project, claude_args)?;
    Ok(terminal.name)
}

fn spawn_in(terminal: &Terminal, claude: &Path, project: &Path, claude_args: Vec<OsString>) -> Result<(), String> {
    let mut command = Command::new(&terminal.program);
    command
        .args(terminal_args(terminal.args, project, claude, claude_args))
        .current_dir(project)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::hosted::strip_editor_env(&mut command);
    // Its own process group: the window outlives the office and ignores signals sent to it.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = command.spawn().map_err(|err| format!("Não consegui abrir o {}: {err}", terminal.name))?;
    std::thread::spawn(move || child.wait()); // reaped in the background, never a zombie
    Ok(())
}

/// The terminal a "No terminal" agent would open in, for the first-run check.
pub fn detected_terminal() -> Option<String> {
    pick_terminal(std::env::var_os("TERMINAL"), std::env::var_os("PATH")).map(|terminal| terminal.name)
}

fn pick_terminal(terminal_env: Option<OsString>, path_env: Option<OsString>) -> Option<Terminal> {
    let search = |name: &OsStr| find_executable(name, path_env.as_deref());
    if let Some(preferred) = terminal_env.filter(|value| !value.is_empty()) {
        if let Some(program) = search(&preferred) {
            let name = program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let args = TERMINALS.iter().find(|(known, _)| *known == name).map_or(GENERIC_ARGS, |(_, args)| *args);
            return Some(Terminal { program, name, args });
        }
    }
    TERMINALS.iter().find_map(|(name, args)| Some(Terminal { program: search(OsStr::new(name))?, name: name.to_string(), args }))
}

pub(crate) fn find_executable(name: &OsStr, path_env: Option<&OsStr>) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.components().count() > 1 {
        return is_executable(candidate).then(|| candidate.to_path_buf());
    }
    std::env::split_paths(path_env?).map(|dir| dir.join(name)).find(|path| is_executable(path))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn terminal_args(prefix: &[&str], project: &Path, claude: &Path, claude_args: Vec<OsString>) -> Vec<OsString> {
    let dir = project.to_string_lossy();
    let mut args: Vec<OsString> = prefix.iter().map(|arg| arg.replace(DIR, &dir).into()).collect();
    args.push(claude.into());
    args.extend(claude_args);
    args
}

fn task_args(task: &str) -> Vec<OsString> {
    let task = task.trim();
    if task.is_empty() {
        return Vec::new();
    }
    // A one-word task could name a subcommand (`claude update`); a trailing space keeps it a prompt.
    vec!["--".into(), if task.contains(char::is_whitespace) { task.into() } else { format!("{task} ").into() }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{Duration, Instant};

    fn fake_bin(dir: &Path, name: &str, script: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, script).unwrap();
        fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn terminal_env_wins_then_the_known_list_in_order() {
        let dir = std::env::temp_dir().join(format!("cpo-terminals-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = Some(dir.clone().into_os_string());
        assert_eq!(pick_terminal(None, path.clone()), None);

        fake_bin(&dir, "alacritty", "");
        fake_bin(&dir, "kgx", "");
        fs::write(dir.join("kitty"), "").unwrap(); // not executable: skipped
        let found = pick_terminal(None, path.clone()).unwrap();
        assert_eq!((found.name.as_str(), found.args), ("kgx", TERMINALS[5].1));

        let chosen = pick_terminal(Some("alacritty".into()), path.clone()).unwrap();
        assert_eq!(chosen.name, "alacritty");
        let custom = fake_bin(&dir, "my-term", "");
        let generic = pick_terminal(Some(custom.clone().into_os_string()), None).unwrap();
        assert_eq!((generic.program, generic.args), (custom, GENERIC_ARGS));
        // A $TERMINAL that does not exist falls back to the list.
        assert_eq!(pick_terminal(Some("nope".into()), path).unwrap().name, "kgx");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn task_reaches_claude_verbatim_as_one_argument() {
        let project = Path::new("/home/u/Code/Meus Projetos/site");
        let claude = Path::new("/home/u/.local/bin/claude");
        let args = terminal_args(&["--working-directory={dir}", "--"], project, claude, task_args("  --dangerously-skip-permissions; rm -rf ~ $(id) \"x\"  "));
        assert_eq!(
            args,
            ["--working-directory=/home/u/Code/Meus Projetos/site", "--", "/home/u/.local/bin/claude", "--", "--dangerously-skip-permissions; rm -rf ~ $(id) \"x\""]
        );
        assert_eq!(terminal_args(&[], project, claude, task_args("   ")), ["/home/u/.local/bin/claude"]);
        assert_eq!(terminal_args(&[], project, claude, task_args("update")), ["/home/u/.local/bin/claude", "--", "update "]);
    }

    #[test]
    fn launch_runs_the_terminal_in_the_project_with_claude_and_the_task() {
        let dir = std::env::temp_dir().join(format!("cpo-launch-{}", std::process::id()));
        let project = dir.join("repo");
        fs::create_dir_all(&project).unwrap();
        let out = dir.join("argv.txt");
        let script = format!("#!/bin/sh\n{{ pwd; printf '%s\\n' \"$@\"; }} > '{}'\n", out.display());
        let terminal = fake_bin(&dir, "kitty", &script);
        let found = pick_terminal(Some(terminal.into_os_string()), None).unwrap();
        spawn_in(&found, Path::new("claude"), &project, task_args("revisar o PR & publicar")).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while !out.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let lines: Vec<String> = fs::read_to_string(&out).unwrap().lines().map(str::to_string).collect();
        let project_text = project.to_string_lossy().into_owned();
        assert_eq!(lines, [project_text.as_str(), "--directory", project_text.as_str(), "claude", "--", "revisar o PR & publicar"]);
        fs::remove_dir_all(dir).unwrap();
    }
}
