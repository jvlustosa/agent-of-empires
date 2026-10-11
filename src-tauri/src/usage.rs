//! Claude plan usage limits (5-hour session and weekly), as shown by `/usage` in Claude Code.
//!
//! Live data comes from the same endpoint Claude Code queries, using its OAuth token. The token is
//! only read (Claude Code owns refreshing it) and goes to curl through stdin, never argv. Offline or
//! with an expired token we fall back to the copy Claude Code caches in ~/.claude.json.

use crate::transcript::parse_timestamp_ms;
use serde::Serialize;
use serde_json::Value;
use std::io::Write;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const REQUEST_TIMEOUT_SECS: u32 = 10;
/// The plan's session limit covers this long from its first message, then resets.
pub const SESSION_WINDOW_MS: i64 = 5 * 60 * 60 * 1000;
// A window rolling over only matters after it had been pressing: a 5 h session resetting at 9%
// would ping every few hours for nothing.
const RESET_NOTICE_MIN_PERCENT: f64 = 75.0;
// The API may take a moment to roll the window over; fetching exactly at resets_at could miss it.
const RESET_FETCH_GRACE_MS: i64 = 20_000;
/// From here a limit gets the clear warning: a red banner on the map and one notification.
pub const ALERT_PERCENT: f64 = 90.0;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub kind: String,
    pub label: String,
    pub percent: f64,
    /// "normal" | "warning" | "critical", as reported by the API.
    pub severity: String,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub limits: Vec<Limit>,
    pub fetched_at: i64,
    /// True when this is Claude Code's cached copy, not a fresh answer.
    pub is_stale: bool,
}

impl Usage {
    /// When the plan's current session window opened, if one is open.
    pub fn session_start(&self) -> Option<i64> {
        let session = self.limits.iter().find(|limit| limit.kind == "session")?;
        session.resets_at.map(|resets_at| resets_at - SESSION_WINDOW_MS)
    }

    /// Every limit short of ALERT_PERCENT: an account worth moving new agents to.
    pub fn has_room(&self) -> bool {
        self.limits.iter().all(|limit| limit.percent < ALERT_PERCENT)
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn label_for(kind: &str, entry: &Value) -> Option<String> {
    match kind {
        "session" => Some("Sessão (5 h)".into()),
        "weekly_all" => Some("Semana".into()),
        "weekly_scoped" => {
            let model = entry.pointer("/scope/model/display_name").and_then(Value::as_str).unwrap_or("modelo");
            Some(format!("Semana · {model}"))
        }
        _ => None,
    }
}

/// Session and weekly always; model-scoped weeks only once they are being used.
pub fn parse_limits(response: &Value) -> Vec<Limit> {
    let Some(entries) = response.get("limits").and_then(Value::as_array) else { return Vec::new() };
    entries
        .iter()
        .filter_map(|entry| {
            let kind = entry.get("kind").and_then(Value::as_str)?;
            let percent = entry.get("percent").and_then(Value::as_f64).unwrap_or(0.0);
            if kind == "weekly_scoped" && percent <= 0.0 {
                return None;
            }
            Some(Limit {
                kind: kind.to_string(),
                label: label_for(kind, entry)?,
                percent,
                severity: entry.get("severity").and_then(Value::as_str).unwrap_or("normal").to_string(),
                resets_at: entry.get("resets_at").and_then(Value::as_str).and_then(parse_timestamp_ms),
            })
        })
        .collect()
}

/// The Claude subscription and its monthly list price in US$ (claude.com/pricing).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub name: String,
    pub monthly_usd: f64,
}

const CONFIG_DIR_VAR: &str = "CLAUDE_CONFIG_DIR";
const UNKNOWN_PLAN: &str = "Conta Claude";

/// Claude Code's config dir: CLAUDE_CONFIG_DIR when set, else ~/.claude.
fn claude_dir() -> Option<PathBuf> {
    std::env::var_os(CONFIG_DIR_VAR).map(PathBuf::from).or_else(|| Some(home()?.join(".claude")))
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Where Claude Code keeps a profile's .claude.json: inside it for a CLAUDE_CONFIG_DIR profile, in
/// the home dir for the default ~/.claude.
fn claude_json_of(home: &Path, dir: &Path) -> PathBuf {
    let inside = dir.join(".claude.json");
    if inside.exists() || !same_dir(dir, &home.join(".claude")) {
        inside
    } else {
        home.join(".claude.json")
    }
}

fn oauth_credentials_in(dir: &Path) -> Option<Value> {
    let mut credentials: Value = serde_json::from_slice(&std::fs::read(dir.join(".credentials.json")).ok()?).ok()?;
    credentials.get_mut("claudeAiOauth").map(Value::take)
}

/// The Claude Code profiles whose sessions the empire counts: `main` and every ~/.claude or
/// ~/.claude-* (another account through CLAUDE_CONFIG_DIR) whose projects dir links to the same one.
/// A profile with its own projects dir is left out, since its tokens are not in the cost.
fn counted_profiles(home: &Path, main: &Path) -> Vec<PathBuf> {
    let Ok(projects) = main.join("projects").canonicalize() else { return vec![main.to_path_buf()] };
    let main_real = main.canonicalize().unwrap_or_else(|_| main.to_path_buf());
    let mut others: Vec<PathBuf> = std::fs::read_dir(home)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|dir| dir.file_name().and_then(|name| name.to_str()).is_some_and(|name| name == ".claude" || name.starts_with(".claude-")))
        .filter(|dir| dir.canonicalize().is_ok_and(|real| real != main_real))
        .filter(|dir| dir.join("projects").canonicalize().is_ok_and(|real| real == projects))
        .collect();
    others.sort();
    std::iter::once(main.to_path_buf()).chain(others).collect()
}

/// A Claude account logged in on this machine (a Claude Code profile) whose sessions the map shows.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Its Claude Code config dir: the id the screen hands back to pick it.
    pub dir: String,
    /// The plan, with the folder when two accounts share it: "Team Premium", "Max 5x (~/.claude-b)".
    pub name: String,
    /// The config dir as "~/.claude-pessoal".
    pub folder: String,
    pub plan: Option<Plan>,
    /// New agents and the scout run on the active account, and the bars on the map follow it.
    pub is_active: bool,
    pub usage: Option<Usage>,
}

/// The logged-in profiles sharing the map's sessions, the app's own config dir first. `saved` (the
/// dir picked in the app) is the active one while it is still here, else the first. No usage yet.
pub fn accounts(saved: Option<&str>) -> Vec<Account> {
    let (Some(home), Some(main)) = (home(), claude_dir()) else { return Vec::new() };
    let dirs: Vec<PathBuf> = counted_profiles(&home, &main).into_iter().filter(|dir| dir.join(".credentials.json").is_file()).collect();
    let active = dirs.iter().position(|dir| saved.is_some_and(|saved| Path::new(saved) == dir)).unwrap_or(0);
    let plans: Vec<Option<Plan>> = dirs.iter().map(|dir| plan_from(&oauth_credentials_in(dir)?)).collect();
    let plan_name = |plan: &Option<Plan>| plan.as_ref().map_or(UNKNOWN_PLAN.to_string(), |plan| plan.name.clone());
    dirs.iter()
        .zip(&plans)
        .enumerate()
        .map(|(index, (dir, plan))| {
            let folder = dir.strip_prefix(&home).map_or_else(|_| dir.display().to_string(), |rest| format!("~/{}", rest.display()));
            let base = plan_name(plan);
            let is_shared = plans.iter().filter(|other| plan_name(other) == base).count() > 1;
            Account {
                dir: dir.display().to_string(),
                name: if is_shared { format!("{base} ({folder})") } else { base },
                folder,
                plan: plan.clone(),
                is_active: index == active,
                usage: None,
            }
        })
        .collect()
}

/// The subscriptions behind the counted sessions, from the plan fields of each account's
/// credentials, never its token. None when one is Enterprise (seat plus usage at API prices) or
/// none is logged in: a partial sum would overstate the subsidy.
pub fn plan() -> Option<Plan> {
    let plans: Vec<Plan> = accounts(None).into_iter().map(|account| account.plan).collect::<Option<_>>()?;
    if plans.is_empty() {
        return None;
    }
    let name = plans.iter().map(|plan| plan.name.as_str()).collect::<Vec<_>>().join(" + ");
    Some(Plan { name, monthly_usd: plans.iter().map(|plan| plan.monthly_usd).sum() })
}

/// List prices billed monthly. A Team premium seat carries the Max rate limit tier.
fn plan_from(oauth: &Value) -> Option<Plan> {
    let tier = oauth.get("rateLimitTier").and_then(Value::as_str).unwrap_or_default();
    let (name, monthly_usd) = match oauth.get("subscriptionType").and_then(Value::as_str)? {
        "pro" => ("Pro", 20.0),
        "max" if tier.contains("20x") => ("Max 20x", 200.0),
        "max" => ("Max 5x", 100.0),
        "team" if tier.contains("max") => ("Team Premium", 125.0),
        "team" => ("Team Standard", 25.0),
        _ => return None,
    };
    Some(Plan { name: name.into(), monthly_usd })
}

/// How a `claude` we start reaches an account, through CLAUDE_CONFIG_DIR.
#[derive(Debug, PartialEq)]
pub enum ConfigDirEnv {
    /// The app's own account: the environment as it is.
    Keep,
    /// The default ~/.claude, whose .claude.json sits in the home dir: the variable must go.
    Unset,
    Set(PathBuf),
}

impl ConfigDirEnv {
    pub fn apply(&self, command: &mut Command) {
        match self {
            Self::Keep => {}
            Self::Unset => {
                command.env_remove(CONFIG_DIR_VAR);
            }
            Self::Set(dir) => {
                command.env(CONFIG_DIR_VAR, dir);
            }
        }
    }

    /// The same as a command prefix, for a terminal: some (gnome-terminal) start the shell from a
    /// server that never sees our environment.
    pub fn prefix(&self) -> Vec<OsString> {
        match self {
            Self::Keep => Vec::new(),
            Self::Unset => vec!["env".into(), "-u".into(), CONFIG_DIR_VAR.into()],
            Self::Set(dir) => {
                let mut assignment = OsString::from(format!("{CONFIG_DIR_VAR}="));
                assignment.push(dir);
                vec!["env".into(), assignment]
            }
        }
    }
}

fn config_dir_env(account: &Path, own: &Path, default: &Path) -> ConfigDirEnv {
    if same_dir(account, own) {
        ConfigDirEnv::Keep
    } else if same_dir(account, default) {
        ConfigDirEnv::Unset
    } else {
        ConfigDirEnv::Set(account.to_path_buf())
    }
}

/// The environment for a `claude` on the account picked in the app.
pub fn active_env() -> ConfigDirEnv {
    let saved = crate::onboarding::Config::load().claude_account;
    let active = accounts(saved.as_deref()).into_iter().find(|account| account.is_active);
    match (active, claude_dir(), home()) {
        (Some(account), Some(own), Some(home)) => config_dir_env(Path::new(&account.dir), &own, &home.join(".claude")),
        _ => ConfigDirEnv::Keep,
    }
}

fn access_token(dir: &Path) -> Option<String> {
    let oauth = oauth_credentials_in(dir)?;
    let expires_at = oauth.get("expiresAt").and_then(Value::as_i64).unwrap_or(i64::MAX);
    if expires_at <= now_ms() {
        return None; // Claude Code refreshes it next time it runs; we never write credentials
    }
    oauth.get("accessToken").and_then(Value::as_str).map(str::to_string)
}

fn fetch_live(dir: &Path) -> Option<Usage> {
    let token = access_token(dir)?;
    let config = format!(
        "url = \"{USAGE_URL}\"\nheader = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: {OAUTH_BETA}\"\n\
         header = \"Accept: application/json\"\nsilent\nfail\nmax-time = {REQUEST_TIMEOUT_SECS}\n"
    );
    let mut child = Command::new("curl")
        .arg("--config")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    child.stdin.take()?.write_all(config.as_bytes()).ok()?;
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    let response: Value = serde_json::from_slice(&output.stdout).ok()?;
    Some(Usage { limits: parse_limits(&response), fetched_at: now_ms(), is_stale: false })
}

fn read_cached(dir: &Path) -> Option<Usage> {
    let config: Value = serde_json::from_slice(&std::fs::read(claude_json_of(&home()?, dir)).ok()?).ok()?;
    let cached = config.get("cachedUsageUtilization")?;
    Some(Usage {
        limits: parse_limits(cached.get("utilization")?),
        fetched_at: cached.get("fetchedAtMs").and_then(Value::as_i64).unwrap_or(0),
        is_stale: true,
    })
}

/// The account in `dir`: live when it answers; otherwise the freshest copy at hand, our last live
/// answer or Claude Code's cache, so one failed fetch does not throw the bars back hours.
pub fn current_usage(dir: &Path, last_live: Option<&Usage>) -> Option<Usage> {
    fetch_live(dir).or_else(|| {
        let ours = last_live.map(|usage| Usage { is_stale: true, ..usage.clone() });
        [ours, read_cached(dir)].into_iter().flatten().max_by_key(|usage| usage.fetched_at)
    })
}

/// Limits that reached ALERT_PERCENT since `previous` (every one past it on the first answer).
pub fn newly_alarming(previous: Option<&Usage>, current: &Usage) -> Vec<Limit> {
    current
        .limits
        .iter()
        .filter(|limit| limit.percent >= ALERT_PERCENT)
        .filter(|limit| {
            !previous.is_some_and(|before| before.limits.iter().any(|b| b.label == limit.label && b.percent >= ALERT_PERCENT))
        })
        .cloned()
        .collect()
}

/// "Sessão (5 h): 93%, reinicia em 1h20", relative so it needs no time zone.
pub fn describe_pressure(limit: &Limit, now: i64) -> String {
    let percent = format!("{}: {}%", limit.label, limit.percent.round());
    let Some(minutes) = limit.resets_at.map(|at| (at - now) / 60_000).filter(|&m| m > 0) else { return percent };
    let until = if minutes < 60 { format!("{minutes}min") } else { format!("{}h{:02}", minutes / 60, minutes % 60) };
    format!("{percent}, reinicia em {until}")
}

/// Pressing limits whose window rolled over between two fetches (`current` after `previous`).
pub fn reset_since(previous: &Usage, current: &Usage) -> Vec<Limit> {
    current
        .limits
        .iter()
        .filter(|limit| {
            previous.limits.iter().any(|before| {
                before.label == limit.label
                    && before.percent >= RESET_NOTICE_MIN_PERCENT
                    && before.resets_at.is_some_and(|at| at <= current.fetched_at)
                    && limit.percent < before.percent
            })
        })
        .cloned()
        .collect()
}

/// Time until the next pressing limit resets, so the poller fetches right then instead of up to
/// a minute later.
pub fn until_next_reset(usage: &Usage) -> Option<Duration> {
    let now = now_ms();
    usage
        .limits
        .iter()
        .filter(|limit| limit.percent >= RESET_NOTICE_MIN_PERCENT)
        .filter_map(|limit| limit.resets_at)
        .map(|at| at + RESET_FETCH_GRACE_MS - now)
        .filter(|&wait| wait > 0)
        .min()
        .map(|wait| Duration::from_millis(wait as u64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plan_comes_from_the_subscription_and_its_tier() {
        let plan = |kind: &str, tier: &str| plan_from(&json!({"subscriptionType": kind, "rateLimitTier": tier})).map(|p| (p.name, p.monthly_usd));
        assert_eq!(plan("max", "default_claude_max_5x"), Some(("Max 5x".into(), 100.0)));
        assert_eq!(plan("max", "default_claude_max_20x"), Some(("Max 20x".into(), 200.0)));
        assert_eq!(plan("pro", "default_claude_ai"), Some(("Pro".into(), 20.0)));
        assert_eq!(plan("team", "default_claude_max_5x"), Some(("Team Premium".into(), 125.0)));
        assert_eq!(plan("team", "default_raven"), Some(("Team Standard".into(), 25.0)));
        assert_eq!(plan("enterprise", ""), None);
    }

    #[test]
    fn profiles_sharing_the_projects_dir_are_counted_together() {
        let home = std::env::temp_dir().join(format!("aoe-usage-profiles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        for dir in [".claude/projects", ".claude-alone/projects", ".claude-mem"] {
            std::fs::create_dir_all(home.join(dir)).unwrap();
        }
        std::fs::create_dir_all(home.join(".claude-pessoal")).unwrap();
        std::os::unix::fs::symlink(home.join(".claude/projects"), home.join(".claude-pessoal/projects")).unwrap();
        let main = home.join(".claude");
        assert_eq!(counted_profiles(&home, &main), [main.clone(), home.join(".claude-pessoal")]);
        // From the linked profile, the main one is found the same way.
        assert_eq!(counted_profiles(&home, &home.join(".claude-pessoal")), [home.join(".claude-pessoal"), main.clone()]);
        // The default profile keeps its .claude.json in the home dir; the others inside themselves.
        assert_eq!(claude_json_of(&home, &main), home.join(".claude.json"));
        assert_eq!(claude_json_of(&home, &home.join(".claude-pessoal")), home.join(".claude-pessoal/.claude.json"));
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn claude_reaches_the_picked_account_through_its_config_dir() {
        let (default, other) = (Path::new("/home/u/.claude"), Path::new("/home/u/.claude-pessoal"));
        // The app's own account runs as it does today; the default one must not carry the variable.
        assert_eq!(config_dir_env(default, default, default), ConfigDirEnv::Keep);
        assert_eq!(config_dir_env(other, default, default), ConfigDirEnv::Set(other.into()));
        assert_eq!(config_dir_env(default, other, default), ConfigDirEnv::Unset);
        assert_eq!(ConfigDirEnv::Set(other.into()).prefix(), ["env", "CLAUDE_CONFIG_DIR=/home/u/.claude-pessoal"]);
        assert_eq!(ConfigDirEnv::Unset.prefix(), ["env", "-u", "CLAUDE_CONFIG_DIR"]);
        assert!(ConfigDirEnv::Keep.prefix().is_empty());
    }

    #[test]
    fn limits_keep_session_and_week_and_skip_unused_model_weeks() {
        let response = json!({"limits": [
            {"kind": "session", "percent": 9, "severity": "normal", "resets_at": "2026-10-01T01:00:00.960101+00:00"},
            {"kind": "weekly_all", "percent": 85, "severity": "warning", "resets_at": "2026-10-04T07:00:00.960121+00:00"},
            {"kind": "weekly_scoped", "percent": 0, "scope": {"model": {"display_name": "Fable"}}},
            {"kind": "weekly_scoped", "percent": 40, "scope": {"model": {"display_name": "Opus"}}},
            {"kind": "something_new", "percent": 50}
        ]});
        let limits = parse_limits(&response);
        let labels: Vec<_> = limits.iter().map(|l| l.label.as_str()).collect();
        assert_eq!(labels, ["Sessão (5 h)", "Semana", "Semana · Opus"]);
        assert_eq!(limits[1].severity, "warning");
        assert_eq!(limits[0].resets_at, parse_timestamp_ms("2026-10-01T01:00:00.960Z"));
    }

    fn limit(label: &str, percent: f64, resets_at: Option<i64>) -> Limit {
        Limit { kind: "session".into(), label: label.into(), percent, severity: "normal".into(), resets_at }
    }

    #[test]
    fn reset_is_a_pressing_window_that_rolled_over() {
        let due = 1_000_000;
        let previous = Usage {
            limits: vec![
                limit("Sessão (5 h)", 96.0, Some(due)),
                limit("Semana", 40.0, Some(due)),
                limit("Semana · Opus", 80.0, Some(due + 1_000)),
            ],
            fetched_at: due - 60_000,
            is_stale: false,
        };
        let after = |session: f64| Usage {
            limits: vec![limit("Sessão (5 h)", session, None), limit("Semana", 0.0, None), limit("Semana · Opus", 82.0, Some(due + 1_000))],
            fetched_at: due + 500,
            is_stale: false,
        };
        let reset: Vec<_> = reset_since(&previous, &after(0.0)).into_iter().map(|l| l.label).collect();
        assert_eq!(reset, ["Sessão (5 h)"], "the light week and the Opus week not yet due stay quiet");
        assert!(reset_since(&previous, &after(96.0)).is_empty(), "the API has not rolled the window over yet");
    }

    #[test]
    fn next_reset_waits_only_for_pressing_limits_still_ahead() {
        let now = now_ms();
        let usage = Usage {
            limits: vec![limit("Sessão (5 h)", 90.0, Some(now + 60_000)), limit("Semana", 10.0, Some(now + 1_000)), limit("Semana · Opus", 95.0, Some(now - 60_000))],
            fetched_at: now,
            is_stale: false,
        };
        let wait = until_next_reset(&usage).expect("the session resets in a minute");
        assert!(wait > Duration::from_secs(70) && wait <= Duration::from_secs(80), "{wait:?}");
    }

    #[test]
    fn alert_fires_once_when_a_limit_crosses_ninety() {
        let usage = |session: f64, week: f64| Usage {
            limits: vec![limit("Sessão (5 h)", session, None), limit("Semana", week, None)],
            fetched_at: 0,
            is_stale: false,
        };
        let labels = |limits: Vec<Limit>| limits.into_iter().map(|l| l.label).collect::<Vec<_>>();
        assert_eq!(labels(newly_alarming(None, &usage(92.0, 40.0))), ["Sessão (5 h)"], "already past it on the first answer");
        assert_eq!(labels(newly_alarming(Some(&usage(89.0, 95.0)), &usage(90.0, 97.0))), ["Sessão (5 h)"], "the week was already warned about");
        assert!(newly_alarming(Some(&usage(91.0, 40.0)), &usage(94.0, 40.0)).is_empty());
    }

    #[test]
    fn pressure_reads_percent_and_time_left() {
        let now = 1_000_000_000;
        assert_eq!(describe_pressure(&limit("Sessão (5 h)", 92.6, Some(now + 80 * 60_000)), now), "Sessão (5 h): 93%, reinicia em 1h20");
        assert_eq!(describe_pressure(&limit("Semana", 91.0, Some(now + 5 * 60_000)), now), "Semana: 91%, reinicia em 5min");
        assert_eq!(describe_pressure(&limit("Semana", 91.0, None), now), "Semana: 91%");
    }

    #[test]
    #[ignore = "hits the network with the local Claude Code login; run with --ignored"]
    fn live_usage_smoke() {
        for account in accounts(None) {
            let usage = current_usage(Path::new(&account.dir), None).expect("usage from API or cache");
            let percents: Vec<_> = usage.limits.iter().map(|l| format!("{} {}%", l.label, l.percent)).collect();
            println!("{} ({}, active: {}): stale {} · {}", account.name, account.folder, account.is_active, usage.is_stale, percents.join(" · "));
            assert!(usage.limits.iter().any(|l| l.kind == "session"));
        }
    }
}
