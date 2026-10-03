//! Claude plan usage limits (5-hour session and weekly), as shown by `/usage` in Claude Code.
//!
//! Live data comes from the same endpoint Claude Code queries, using its OAuth token. The token is
//! only read (Claude Code owns refreshing it) and goes to curl through stdin, never argv. Offline or
//! with an expired token we fall back to the copy Claude Code caches in ~/.claude.json.

use crate::transcript::parse_timestamp_ms;
use serde::Serialize;
use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
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

fn access_token() -> Option<String> {
    let path = home()?.join(".claude").join(".credentials.json");
    let credentials: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let oauth = credentials.get("claudeAiOauth")?;
    let expires_at = oauth.get("expiresAt").and_then(Value::as_i64).unwrap_or(i64::MAX);
    if expires_at <= now_ms() {
        return None; // Claude Code refreshes it next time it runs; we never write credentials
    }
    oauth.get("accessToken").and_then(Value::as_str).map(str::to_string)
}

fn fetch_live() -> Option<Usage> {
    let token = access_token()?;
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

fn read_cached() -> Option<Usage> {
    let config: Value = serde_json::from_slice(&std::fs::read(home()?.join(".claude.json")).ok()?).ok()?;
    let cached = config.get("cachedUsageUtilization")?;
    Some(Usage {
        limits: parse_limits(cached.get("utilization")?),
        fetched_at: cached.get("fetchedAtMs").and_then(Value::as_i64).unwrap_or(0),
        is_stale: true,
    })
}

/// Live when it answers; otherwise the freshest copy at hand, our last live answer or Claude
/// Code's cache, so one failed fetch does not throw the bars back hours.
pub fn current_usage(last_live: Option<&Usage>) -> Option<Usage> {
    fetch_live().or_else(|| {
        let ours = last_live.map(|usage| Usage { is_stale: true, ..usage.clone() });
        [ours, read_cached()].into_iter().flatten().max_by_key(|usage| usage.fetched_at)
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
        let usage = current_usage(None).expect("usage from API or cache");
        assert!(!usage.is_stale, "expected a live answer, got the cache");
        assert!(usage.limits.iter().any(|l| l.kind == "session"));
    }
}
