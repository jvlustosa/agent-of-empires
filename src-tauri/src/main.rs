#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod approval;
mod collector;
mod editor;
mod empire;
mod history;
mod hosted;
mod music;
mod notify;
mod onboarding;
mod phone;
mod projects;
mod scout;
mod sound;
mod terminal;
mod transcript;
mod usage;

use approval::{ApprovalRequest, Approvals, Decision};
use collector::{Collector, Snapshot};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const SNAPSHOT_EVENT: &str = "snapshot";
const APPROVALS_EVENT: &str = "approvals";
const AUTO_APPROVE_EVENT: &str = "auto_approve";
const HOSTED_EVENT: &str = "hosted";
// A hosted agent handed to Cursor must exit first, or two processes would drive one session.
const HANDOFF_WAIT: Duration = Duration::from_secs(8);
const USAGE_EVENT: &str = "usage";
// Every minute, so the bars follow the work (claude.ai use counts too, unseen by the transcripts).
const USAGE_POLL_INTERVAL: Duration = Duration::from_secs(60);
const LIMIT_RESET_EVENT: &str = "limit_reset";
const MUSIC_TRACK_EVENT: &str = "music_track";
const APP_NAME: &str = "Agent of Empires";
// Argument Claude Code passes when running us as its PermissionRequest hook.
const PERMISSION_HOOK_FLAG: &str = "--permission-hook";
const TASK_MAX_CHARS: usize = 4000;

#[derive(Default)]
struct LatestSnapshot(Mutex<Option<Snapshot>>);

/// Wakes the watcher for an immediate rescan from scratch.
struct RefreshTrigger(mpsc::Sender<()>);

#[derive(Default)]
struct LatestUsage(Mutex<Option<usage::Usage>>);

/// Wakes the usage poller for an immediate fetch.
struct UsageTrigger(mpsc::Sender<()>);

/// Limits that reset while the map was out of sight, celebrated once it is back in view.
#[derive(Default)]
struct PendingLimitReset(Mutex<Vec<usage::Limit>>);

#[tauri::command]
fn get_usage(latest: tauri::State<LatestUsage>) -> Option<usage::Usage> {
    latest.0.lock().ok()?.clone()
}

#[tauri::command]
fn refresh_usage(trigger: tauri::State<UsageTrigger>) -> Result<(), String> {
    trigger.0.send(()).map_err(|_| "O monitor de limites parou".to_string())
}

fn spawn_usage_watcher(app: AppHandle, wake: mpsc::Receiver<()>) {
    std::thread::spawn(move || {
        // Resets are judged between live answers only: the cached copy can be older than the last one.
        let mut last_live: Option<usage::Usage> = None;
        loop {
            // Opt-in at first run: it is the one call that leaves this machine.
            let is_usage_on = onboarding::Config::load().is_usage_on;
            if !is_usage_on {
                last_live = None;
            }
            if let Some(usage) = is_usage_on.then(|| usage::current_usage(last_live.as_ref())).flatten() {
                if let Ok(mut latest) = app.state::<LatestUsage>().0.lock() {
                    *latest = Some(usage.clone());
                }
                if let Err(err) = app.emit(USAGE_EVENT, &usage) {
                    eprintln!("[usage] failed to emit: {err}");
                }
                if !usage.is_stale {
                    announce_limit_alert(&app, usage::newly_alarming(last_live.as_ref(), &usage));
                    if let Some(previous) = &last_live {
                        announce_limit_reset(&app, usage::reset_since(previous, &usage));
                    }
                    last_live = Some(usage);
                }
            }
            let wait = last_live.as_ref().and_then(usage::until_next_reset).map_or(USAGE_POLL_INTERVAL, |until| until.min(USAGE_POLL_INTERVAL));
            if let Err(RecvTimeoutError::Disconnected) = wake.recv_timeout(wait) {
                return;
            }
        }
    });
}

/// A limit past usage::ALERT_PERCENT: one notification per crossing, since the map may be in the
/// tray; the red banner over the bars stays until it resets.
fn announce_limit_alert(app: &AppHandle, limits: Vec<usage::Limit>) {
    if limits.is_empty() {
        return;
    }
    let now = usage::now_ms();
    let summary: Vec<String> = limits.iter().map(|limit| usage::describe_pressure(limit, now)).collect();
    let title = if limits.iter().any(|limit| limit.percent >= 100.0) { "Limite do Claude esgotado" } else { "Limite do Claude quase no fim" };
    let opener = app.clone();
    notify::send(title, &summary.join("\n"), move || show_main_window(&opener));
}

/// A pressing limit reset: a desktop notification now, and the fanfare once the map is in view.
fn announce_limit_reset(app: &AppHandle, limits: Vec<usage::Limit>) {
    if limits.is_empty() {
        return;
    }
    let summary: Vec<String> = limits.iter().map(|limit| format!("{}: {}% usado", limit.label, limit.percent.round())).collect();
    let body = format!("{}\nOs aldeões podem voltar ao trabalho.", summary.join(" · "));
    let opener = app.clone();
    notify::send("Limite do Claude reiniciado", &body, move || show_main_window(&opener));
    if let Ok(mut pending) = app.state::<PendingLimitReset>().0.lock() {
        pending.extend(limits);
    }
    let is_in_view = app
        .get_webview_window("main")
        .is_some_and(|window| window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false));
    if is_in_view {
        celebrate_limit_reset(app);
    }
}

fn celebrate_limit_reset(app: &AppHandle) {
    let limits = match app.state::<PendingLimitReset>().0.lock() {
        Ok(mut pending) => std::mem::take(&mut *pending),
        Err(_) => return,
    };
    if limits.is_empty() {
        return;
    }
    if let Err(err) = app.emit(LIMIT_RESET_EVENT, &limits) {
        eprintln!("[usage] failed to emit the reset: {err}");
    }
}

/// Plays a sound effect natively ("finished" or "needs_you"); WebAudio is silent in this webview.
#[tauri::command]
fn play_sound(name: String) -> Result<(), String> {
    sound::play(&name)
}

/// Turns the soundtrack on or off; it also pauses on its own while the window is in the tray.
#[tauri::command]
fn set_music(is_on: bool, music: tauri::State<music::Music>) {
    music.set_on(is_on);
}

/// Soundtrack loudness, 0 to 1.5 (1 is the mix as written); heard mid-song.
#[tauri::command]
fn set_music_volume(volume: f64, music: tauri::State<music::Music>) {
    music.set_volume(volume);
}

/// "lofi" (the default) or "town" (the Ragnarok-style themes).
#[tauri::command]
fn set_music_station(station: String, music: tauri::State<music::Music>) -> Result<(), String> {
    let station = music::Station::parse(&station).ok_or_else(|| format!("Estação desconhecida: {station}"))?;
    music.set_station(station);
    Ok(())
}

#[tauri::command]
fn skip_music_track(music: tauri::State<music::Music>) {
    music.skip();
}

/// The song playing now; later ones arrive as `music_track` events.
#[tauri::command]
fn get_music_track(music: tauri::State<music::Music>) -> Option<&'static str> {
    music.now_playing()
}

#[tauri::command]
fn get_snapshot(latest: tauri::State<LatestSnapshot>) -> Option<Snapshot> {
    latest.0.lock().ok()?.clone()
}

/// Rereads every session and transcript from scratch and pushes the result even if unchanged.
#[tauri::command]
fn refresh_snapshot(trigger: tauri::State<RefreshTrigger>) -> Result<(), String> {
    trigger.0.send(()).map_err(|_| "O monitor de sessões parou".to_string())
}

#[tauri::command]
fn get_approvals(approvals: tauri::State<Arc<Approvals>>) -> Vec<ApprovalRequest> {
    approvals.list()
}

/// Answers a pending prompt with a click in the panel (answers: AskUserQuestion choices).
#[tauri::command]
fn resolve_approval(
    id: u64,
    decision: Decision,
    answers: Option<serde_json::Value>,
    approvals: tauri::State<Arc<Approvals>>,
) -> Result<(), String> {
    if approvals.resolve(id, decision, answers) {
        Ok(())
    } else {
        Err("Esse pedido já foi respondido ou expirou".into())
    }
}

/// "Aprovar tudo por 10 min": on allows every permission prompt for that long; returns when it ends.
#[tauri::command]
fn set_auto_approve(is_on: bool, approvals: tauri::State<Arc<Approvals>>) -> Option<i64> {
    approvals.set_auto_allow(is_on.then_some(approval::AUTO_APPROVE_WINDOW))
}

#[tauri::command]
fn get_auto_approve(approvals: tauri::State<Arc<Approvals>>) -> Option<i64> {
    approvals.auto_allow_until()
}

#[tauri::command]
async fn list_projects() -> Vec<projects::Project> {
    tauri::async_runtime::spawn_blocking(projects::list_projects).await.unwrap_or_default()
}

/// The chosen repository in the "Novo agente" gallery: README summary, stack, branch, last commit.
#[tauri::command]
async fn project_preview(path: String) -> Result<projects::Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Only folders we listed ourselves, as for deploy_agent.
        let project = projects::list_projects().into_iter().find(|p| p.path == path).ok_or("Esse projeto não está na lista")?;
        Ok(projects::preview(std::path::Path::new(&project.path)))
    })
    .await
    .map_err(|err| err.to_string())?
}

// The empire's numbers (git, agent hours and tokens per repository, the session's from the plan's
// open session window); reads only what changed since last time.
#[tauri::command]
async fn get_empire(app: AppHandle) -> empire::Empire {
    let session_start = app.state::<LatestUsage>().0.lock().ok().and_then(|latest| latest.as_ref()?.session_start());
    tauri::async_runtime::spawn_blocking(move || empire::empire(session_start)).await.unwrap_or_default()
}

/// Which of these folders have a Cursor (or VS Code) window open, by the editor's name: a base
/// counts as active then, even with no agent in it.
#[tauri::command]
async fn editor_folders(folders: Vec<String>) -> std::collections::HashMap<String, &'static str> {
    tauri::async_runtime::spawn_blocking(move || editor::open_folders(&folders)).await.unwrap_or_default()
}

#[tauri::command]
fn get_hosted(hosted: tauri::State<Arc<hosted::Hosted>>) -> Vec<String> {
    hosted.session_ids()
}

/// Next user turn for an agent the office hosts ("seguir em frente", a typed reply).
#[tauri::command]
fn send_to_agent(session_id: String, text: String, hosted: tauri::State<Arc<hosted::Hosted>>) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > TASK_MAX_CHARS {
        return Err("Escreva a mensagem (até 4000 caracteres)".into());
    }
    hosted.send(&session_id, text)
}

/// A live editor session in the folder tells us which Cursor window to put a tab in.
fn editor_window_in(latest: &LatestSnapshot, folder: &str) -> Option<u32> {
    latest.0.lock().ok().and_then(|snapshot| {
        snapshot.as_ref()?.agents.iter().filter(|a| a.cwd == folder).find_map(|a| editor::locate(a.pid)?.window_id)
    })
}

/// Stops the hosted process, then reopens the same session in a Cursor tab.
#[tauri::command]
async fn move_to_cursor(
    session_id: String,
    latest: tauri::State<'_, LatestSnapshot>,
    hosted: tauri::State<'_, Arc<hosted::Hosted>>,
) -> Result<String, String> {
    let cwd = latest
        .0
        .lock()
        .ok()
        .and_then(|s| s.as_ref()?.agents.iter().find(|a| a.id == session_id).map(|a| a.cwd.clone()))
        .ok_or("Sessão não está mais aberta")?;
    let pid = hosted.pid_of(&session_id).ok_or("Esse agente não está rodando aqui no app")?;
    let window_id = editor_window_in(&latest, &cwd);
    let hosted = hosted.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // The window must be up before the agent stops, or a failed handoff leaves the session nowhere.
        editor::focus_project_window(std::path::Path::new(&cwd), window_id)
            .map_err(|err| format!("{err}. O agente continua aqui no app"))?;
        collector::send_sigterm(pid).map_err(|err| format!("Não consegui parar o agente: {err}"))?;
        let deadline = std::time::Instant::now() + HANDOFF_WAIT;
        while hosted.pid_of(&session_id).is_some() {
            if std::time::Instant::now() > deadline {
                return Err("O agente não parou a tempo; tente de novo".to_string());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        editor::resume_in_cursor(std::path::Path::new(&cwd), &session_id, window_id)
    })
    .await
    .map_err(|err| err.to_string())??;
    Ok("Sessão retomada no Cursor".to_string())
}

/// mode "office": the app hosts the agent and it starts at once. mode "cursor": a prefilled tab.
/// mode "terminal": a new terminal window already running `claude` (the task is optional there).
#[tauri::command]
async fn deploy_agent(
    path: String,
    task: String,
    mode: Option<String>,
    latest: tauri::State<'_, LatestSnapshot>,
    hosted: tauri::State<'_, Arc<hosted::Hosted>>,
) -> Result<String, String> {
    let task = task.trim().to_string();
    let is_terminal = mode.as_deref() == Some("terminal");
    if task.is_empty() && !is_terminal {
        return Err("Escreva o que o agente deve fazer".into());
    }
    if task.chars().count() > TASK_MAX_CHARS {
        return Err(format!("A tarefa passa de {TASK_MAX_CHARS} caracteres"));
    }
    // Only folders we listed ourselves: the UI never hands us an arbitrary path to open.
    let project = tauri::async_runtime::spawn_blocking(projects::list_projects)
        .await
        .map_err(|err| err.to_string())?
        .into_iter()
        .find(|p| p.path == path)
        .ok_or("Esse projeto não está na lista")?;
    if is_terminal {
        let name = terminal::launch_claude(&hosted::find_claude(), std::path::Path::new(&project.path), &task)?;
        return Ok(format!("Claude aberto num terminal novo ({name}) em {}", project.name));
    }
    if mode.as_deref() != Some("cursor") {
        hosted.spawn(std::path::Path::new(&project.path), &task, None)?;
        return Ok(format!("Agente trabalhando em {}: aprovações e perguntas aparecem aqui", project.name));
    }
    let window_id = editor_window_in(&latest, &project.path);
    let raise = tauri::async_runtime::spawn_blocking(move || editor::deploy_agent(std::path::Path::new(&project.path), &task, window_id))
        .await
        .map_err(|err| err.to_string())??;
    Ok(match raise {
        editor::Raise::Raised => "Agente pronto no Cursor: confirme o pedido com Enter".to_string(),
        _ => "Aba do Claude criada no Cursor: vá até a janela do projeto e confirme com Enter".to_string(),
    })
}

/// Past sessions of a listed repository, newest first: the base's "Histórico de sessões".
#[tauri::command]
async fn list_sessions(path: String) -> Result<Vec<history::PastSession>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = projects::claude_projects_dir().ok_or("Não achei a pasta do Claude Code")?;
        let repos = projects::list_projects();
        let repo = repos.iter().find(|p| p.path == path).ok_or("Esse projeto não está na lista")?;
        Ok(history::list_sessions(&root, repo, &repos))
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Reopens a past session where it ran: mode "terminal" (`claude --resume`), "cursor" (a tab) or
/// "office" (hosted here, with `task` as its next turn). A session still open is never resumed twice.
#[tauri::command]
async fn resume_session(
    path: String,
    session_id: String,
    mode: String,
    task: Option<String>,
    latest: tauri::State<'_, LatestSnapshot>,
    hosted: tauri::State<'_, Arc<hosted::Hosted>>,
) -> Result<String, String> {
    let task = task.unwrap_or_default().trim().to_string();
    if mode == "office" && (task.is_empty() || task.chars().count() > TASK_MAX_CHARS) {
        return Err(format!("Escreva o próximo pedido (até {TASK_MAX_CHARS} caracteres)"));
    }
    let is_open = latest
        .0
        .lock()
        .ok()
        .and_then(|snapshot| snapshot.as_ref().map(|s| s.agents.iter().any(|a| a.id == session_id)))
        .unwrap_or(false);
    if is_open || hosted.pid_of(&session_id).is_some() {
        return Err("Essa sessão está aberta agora: clique no aldeão dela".into());
    }
    // Found again on disk: the folder it runs in never comes from the UI.
    let session = tauri::async_runtime::spawn_blocking(move || {
        let root = projects::claude_projects_dir()?;
        let repos = projects::list_projects();
        let repo = repos.iter().find(|p| p.path == path)?;
        history::find_session(&root, repo, &repos, &session_id)
    })
    .await
    .map_err(|err| err.to_string())?
    .ok_or("Não achei essa sessão no histórico do repositório")?;
    let cwd = std::path::PathBuf::from(&session.cwd);
    if !cwd.is_dir() {
        return Err(format!("A pasta dessa sessão não existe mais: {}", session.cwd));
    }
    match mode.as_str() {
        "terminal" => {
            let name = terminal::resume_claude(&hosted::find_claude(), &cwd, &session.id)?;
            Ok(format!("Sessão retomada num terminal novo ({name}): {}", session.title))
        }
        "cursor" => {
            let id = session.id.clone();
            let window_id = editor_window_in(&latest, &session.cwd);
            tauri::async_runtime::spawn_blocking(move || editor::resume_in_cursor(&cwd, &id, window_id)).await.map_err(|err| err.to_string())??;
            Ok(format!("Sessão retomada no Cursor: {}", session.title))
        }
        "office" => {
            hosted.spawn(&cwd, &task, Some(&session.id))?;
            Ok(format!("Sessão retomada aqui no app: {}", session.title))
        }
        _ => Err("Escolha onde retomar: app, Cursor ou terminal".into()),
    }
}

/// Stops the Claude process behind a listed session; it then walks out and frees its desk.
#[tauri::command]
fn end_session(session_id: String, latest: tauri::State<LatestSnapshot>, trigger: tauri::State<RefreshTrigger>) -> Result<(), String> {
    let is_listed = latest
        .0
        .lock()
        .ok()
        .and_then(|snapshot| snapshot.as_ref().map(|s| s.agents.iter().any(|a| a.id == session_id)))
        .unwrap_or(false);
    if !is_listed {
        return Err("Sessão não está mais aberta".into());
    }
    collector::terminate_session(&session_id)?;
    let _ = trigger.0.send(()); // show it leaving right away instead of on the next poll
    Ok(())
}

/// Reveals the session's tab in the editor window that runs it.
#[tauri::command]
async fn open_session(session_id: String, latest: tauri::State<'_, LatestSnapshot>) -> Result<String, String> {
    // Resolved from our own snapshot: the UI only names the session, never the process or path.
    let agent = latest
        .0
        .lock()
        .map_err(|_| "Estado indisponível".to_string())?
        .as_ref()
        .and_then(|snapshot| snapshot.agents.iter().find(|a| a.id == session_id).cloned())
        .ok_or("Sessão não está mais aberta")?;
    let host = editor::locate(agent.pid).ok_or("Sessão de terminal ou SDK: abra pelo terminal onde ela roda")?;
    let editor_name = host.name;
    let raise = tauri::async_runtime::spawn_blocking(move || editor::open_session(&host, &agent.id, &agent.cwd))
        .await
        .map_err(|err| err.to_string())??;
    Ok(match raise {
        editor::Raise::Raised => format!("Sessão aberta no {editor_name}"),
        editor::Raise::WindowNotFound => format!("Aba aberta no {editor_name}, mas não achei a janela para trazer para frente"),
        editor::Raise::ShellExtensionMissing => {
            format!("Aba aberta no {editor_name}. Para a janela vir para frente, ative a extensão Activate Window By Title do GNOME")
        }
    })
}

// Polls forever, even with the window hidden in the tray; the UI only hears about changes.
fn spawn_session_watcher(app: AppHandle, refresh: mpsc::Receiver<()>) {
    std::thread::spawn(move || {
        let mut collector = Collector::new();
        let mut last_agents_json = String::new();
        let mut is_forced = false;
        loop {
            let snapshot = collector.snapshot();
            let agents_json = serde_json::to_string(&snapshot.agents).unwrap_or_default();
            if is_forced || agents_json != last_agents_json {
                last_agents_json = agents_json;
                if let Ok(mut latest) = app.state::<LatestSnapshot>().0.lock() {
                    *latest = Some(snapshot.clone());
                }
                if let Err(err) = app.emit(SNAPSHOT_EVENT, &snapshot) {
                    eprintln!("[watcher] failed to emit snapshot: {err}");
                }
            }
            is_forced = match refresh.recv_timeout(POLL_INTERVAL) {
                Ok(()) => {
                    collector = Collector::new(); // drops cached offsets and paths
                    true
                }
                Err(RecvTimeoutError::Timeout) => false,
                Err(RecvTimeoutError::Disconnected) => return,
            };
        }
    });
}

fn refresh_and_reload(app: &AppHandle) {
    let _ = app.state::<RefreshTrigger>().0.send(());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("location.reload()");
    }
    show_main_window(app);
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    app.state::<music::Music>().set_window_shown(true);
    celebrate_limit_reset(app);
}

// Autostart is opt-in (first-run setup or the tray); once on, the entry is rewritten so it follows
// the binary if it moves.
fn sync_autostart(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let launcher = app.autolaunch();
    if launcher.is_enabled()? {
        launcher.enable()?;
    }
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let is_autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let open = MenuItem::with_id(app, "open", "Abrir o mapa", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Atualizar", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Abrir ao iniciar a sessão", true, is_autostart_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &autostart, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main").tooltip(APP_NAME).menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id.as_ref() {
        "open" => show_main_window(app),
        "refresh" => refresh_and_reload(app),
        "autostart" => {
            let launcher = app.autolaunch();
            let result = if launcher.is_enabled().unwrap_or(false) { launcher.disable() } else { launcher.enable() };
            if let Err(err) = result {
                eprintln!("[tray] failed to toggle autostart: {err}");
            }
            let _ = autostart.set_checked(launcher.is_enabled().unwrap_or(false));
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show_main_window(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

fn start_approval_server(app: &AppHandle) -> Arc<Approvals> {
    let emitter = app.clone();
    let approvals = Approvals::new(Box::new(move |list| {
        // A new prompt pops the hidden window back so the 60 s answer window is not wasted.
        if !list.is_empty() {
            show_main_window(&emitter);
        }
        if let Err(err) = emitter.emit(APPROVALS_EVENT, &list) {
            eprintln!("[approvals] failed to emit: {err}");
        }
    }));
    if let Err(err) = approval::serve(approvals.clone(), &approval::socket_path()) {
        eprintln!("[approvals] socket unavailable, prompts stay in the editor: {err}");
    }
    approvals
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some(PERMISSION_HOOK_FLAG) {
        approval::hook_main();
        return;
    }
    let (refresh_tx, refresh_rx) = mpsc::channel();
    let (usage_tx, usage_rx) = mpsc::channel();
    tauri::Builder::default()
        // Registered first (plugin requirement): launching again, e.g. from the dock, reopens this window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(LatestSnapshot::default())
        .manage(RefreshTrigger(refresh_tx))
        .manage(LatestUsage::default())
        .manage(UsageTrigger(usage_tx))
        .manage(PendingLimitReset::default())
        .manage(music::Music::default())
        .invoke_handler(tauri::generate_handler![
            play_sound, set_music, set_music_volume, set_music_station, skip_music_track, get_music_track, get_snapshot, refresh_snapshot, open_session, get_approvals, resolve_approval, set_auto_approve, get_auto_approve, list_projects, project_preview, get_empire, deploy_agent, end_session, get_usage, refresh_usage,
            get_hosted, send_to_agent, move_to_cursor, list_sessions, resume_session, editor_folders,
            onboarding::get_config, onboarding::get_setup, onboarding::set_projects_root, onboarding::add_repo, onboarding::finish_setup, onboarding::set_usage_on,
            scout::get_scout, scout::list_scout_skills, scout::read_scout_skill, scout::save_scout_skill, scout::list_scout_connectors, scout::list_scout_extra_connectors, scout::run_routine, scout::scout_prompt, scout::set_scout_equipment, scout::set_scout_village, scout::start_scout, scout::set_mission_status,
            scout::open_mission_source, phone::get_phone, phone::set_phone, phone::reset_phone_token,
            phone::set_phone_public_url, phone::set_phone_token_lifetime])
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            scout::init(&config_dir);
            phone::init(&config_dir);
            onboarding::init(config_dir);
            let handle = app.handle().clone();
            // Debug builds live in target/debug: registering them at login would go stale.
            if !cfg!(debug_assertions) {
                if let Err(err) = sync_autostart(&handle) {
                    eprintln!("[setup] failed to refresh autostart: {err}");
                }
                onboarding::refresh_permission_hook();
            }
            let approvals = start_approval_server(&handle);
            let emitter = handle.clone();
            let hosted_agents = hosted::Hosted::new(
                hosted::find_claude(),
                approvals.clone(),
                Box::new(move |ids| {
                    if let Err(err) = emitter.emit(HOSTED_EVENT, &ids) {
                        eprintln!("[hosted] failed to emit: {err}");
                    }
                }),
            );
            app.manage(approvals);
            app.manage(hosted_agents);
            // After the agents it reads from; serves again at once if it was on when the app closed.
            app.manage(phone::Phone::new(handle.clone()));
            let emitter = handle.clone();
            app.state::<music::Music>().on_track(Box::new(move |title| {
                if let Err(err) = emitter.emit(MUSIC_TRACK_EVENT, title) {
                    eprintln!("[music] failed to emit: {err}");
                }
            }));
            build_tray(&handle)?;
            spawn_usage_watcher(handle.clone(), usage_rx);
            scout::spawn_routines(handle.clone());
            spawn_session_watcher(handle, refresh_rx);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing hides to the tray so sessions keep being watched; "Sair" quits for real.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                window.state::<music::Music>().set_window_shown(false);
            }
            // Coming back to a map left behind other windows also counts as opening the app.
            WindowEvent::Focused(true) => celebrate_limit_reset(window.app_handle()),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("failed to run Agent of Empires");
}
