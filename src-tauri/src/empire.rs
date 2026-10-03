//! The empire's numbers for every repository in ~/Code, all read from the disk: git gives the
//! commits and lines of the last 7 days (gold and wood on the map), Claude Code's transcripts the
//! agent hours (food, and with commits the experience that raises a base's era) and tokens, plus a
//! 30-day history of commits and hours. Everything is cached, so a refresh only reads what changed since the last one.

use crate::collector::project_slug;
use crate::projects::{self, Project};
use crate::transcript::parse_timestamp_ms;
use crate::usage::SESSION_WINDOW_MS;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const MINUTE_MS: i64 = 60 * 1000;
const WEEK_DAYS: i64 = 7;
const HISTORY_DAYS: i64 = 30;
// Two transcript entries this close are the agent working; a longer gap is it waiting on you.
const ACTIVE_GAP_MS: i64 = 5 * 60 * 1000;
// Git numbers are reread when HEAD moves, or at least this often (the 7-day window slides).
const GIT_TTL_MS: i64 = 60 * 60 * 1000;
const TIMESTAMP_KEY: &[u8] = b"\"timestamp\":\"";
const TIMESTAMP_LEN: usize = 24; // 2026-09-30T16:23:22.576Z
const USAGE_KEY: &[u8] = b"\"usage\":{";
// A reply's content blocks land on consecutive lines (tool results may slip between them); this
// many recent replies are enough to count each one once.
const RECENT_MESSAGE_IDS: usize = 16;
// Rough weight of each kind of token against the plan's limits, by its API price next to an input
// token: output costs 5x, a cache write 1.25x and a cache read a tenth (cheap, but every turn
// rereads the whole context, so it adds up).
const OUTPUT_WEIGHT: f64 = 5.0;
const CACHE_WRITE_WEIGHT: f64 = 1.25;
const CACHE_READ_WEIGHT: f64 = 0.1;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub name: String,
    pub path: String,
    /// Commits in the last 7 days: gold.
    pub commits_week: u32,
    /// Lines added in the last 7 days: wood.
    pub lines_added_week: u64,
    /// Minutes Claude Code agents worked here in the last 7 days: food.
    pub agent_minutes_week: u32,
    /// Minutes agents worked here in every transcript still on disk (Claude Code prunes old ones).
    pub agent_minutes_total: u32,
    /// Tokens agents spent here in the last 7 days: input, output and cache writes (cache reads,
    /// the same context reread every turn, would dwarf the rest).
    pub tokens_week: u64,
    /// Tokens agents spent here since the plan's session window opened, counted as tokens_week.
    pub tokens_session: u64,
    /// This repository's part of what every repository's agents spent in the session window, 0 to
    /// 1, by the weight of each kind of token against the plan's limits.
    pub session_share: f64,
    pub commits_total: u32,
    /// The first commit: when the base was founded.
    pub founded_at: Option<i64>,
    /// Files git tracks: stone.
    pub tracked_files: Option<u32>,
    /// Some agent has worked here; the others are still under the fog of war.
    pub is_explored: bool,
}

/// One day of the whole empire, for its history.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    /// Local midnight that starts the day, epoch milliseconds.
    pub day_start: i64,
    pub commits: u32,
    pub agent_minutes: u32,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Empire {
    pub generated_at: i64,
    pub repos: Vec<RepoStats>,
    /// The last 30 days, oldest first.
    pub days: Vec<DayStats>,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct GitStats {
    commits_week: u32,
    lines_added_week: u64,
    commits_total: u32,
    founded_at: Option<i64>,
    /// Commits per local day over the last 30 days.
    commits_by_day: BTreeMap<i64, u32>,
}

/// An agent's time in one repository: the week, everything on disk, and seconds per local day.
#[derive(Debug, Default)]
struct AgentTime {
    week: u32,
    total: u32,
    seconds_by_day: BTreeMap<i64, u32>,
    tokens_week: u64,
    session: Spend,
}

/// What agents spent: tokens as the empire counts them, and their weight against the plan's limits.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Spend {
    tokens: u64,
    weight: f64,
}

impl Spend {
    fn add(&mut self, other: Spend) {
        self.tokens += other.tokens;
        self.weight += other.weight;
    }
}

struct GitEntry {
    head_at: Option<i64>,
    read_at: i64,
    stats: GitStats,
}

/// What a transcript has given so far: active seconds and tokens per local day, and where to
/// resume reading.
#[derive(Debug, Default)]
struct TranscriptScan {
    offset: u64,
    last_at: Option<i64>,
    seconds_by_day: BTreeMap<i64, u32>,
    tokens_by_day: BTreeMap<i64, u64>,
    /// Spending per minute (epoch minutes), only as far back as a session window reaches.
    spend_by_minute: BTreeMap<i64, Spend>,
    /// Recent replies and what was already counted for each.
    recent_replies: VecDeque<(String, Spend)>,
}

/// The slice of an assistant entry the token count needs.
#[derive(Deserialize)]
struct UsageEntry {
    message: Option<UsageMessage>,
}

#[derive(Deserialize)]
struct UsageMessage {
    id: Option<String>,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

impl Usage {
    // Cache reads stay out of the token count (the same context reread every turn would dwarf the
    // rest) but weigh on the limits.
    fn spend(&self) -> Spend {
        let [input, output, cache_write, cache_read] =
            [self.input_tokens, self.output_tokens, self.cache_creation_input_tokens, self.cache_read_input_tokens].map(Option::unwrap_or_default);
        let weight = input as f64 + output as f64 * OUTPUT_WEIGHT + cache_write as f64 * CACHE_WRITE_WEIGHT + cache_read as f64 * CACHE_READ_WEIGHT;
        Spend { tokens: input + output + cache_write, weight }
    }
}

#[derive(Default)]
struct Cache {
    git: HashMap<PathBuf, GitEntry>,
    transcripts: HashMap<PathBuf, TranscriptScan>,
}

static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

/// Every repository of ~/Code with its numbers; session numbers from `session_start` (the plan's
/// open session window).
pub fn empire(session_start: Option<i64>) -> Empire {
    let now = now_ms();
    // No window open (or an old usage reading whose window already closed): the last 5 h stand in.
    let session_start = session_start.filter(|start| (now - SESSION_WINDOW_MS..=now).contains(start)).unwrap_or(now - SESSION_WINDOW_MS);
    let repos = projects::list_projects();
    let mut cache = CACHE.get_or_init(Default::default).lock().unwrap_or_else(PoisonError::into_inner);
    let time = agent_time_by_repo(&mut cache.transcripts, &repos, now, session_start);
    refresh_git(&mut cache.git, &repos, now);
    let session_weight: f64 = time.values().map(|agent| agent.session.weight).sum();
    let empty = AgentTime::default();
    let list = repos
        .iter()
        .map(|project| {
            let git = cache.git.get(Path::new(&project.path)).map(|entry| entry.stats.clone()).unwrap_or_default();
            let agent = time.get(&project.path).unwrap_or(&empty);
            RepoStats {
                name: project.name.clone(),
                path: project.path.clone(),
                commits_week: git.commits_week,
                lines_added_week: git.lines_added_week,
                agent_minutes_week: agent.week,
                agent_minutes_total: agent.total,
                tokens_week: agent.tokens_week,
                tokens_session: agent.session.tokens,
                session_share: if session_weight > 0.0 { agent.session.weight / session_weight } else { 0.0 },
                commits_total: git.commits_total,
                founded_at: git.founded_at,
                tracked_files: project.tracked_files,
                is_explored: project.last_claude_at.is_some(),
            }
        })
        .collect();
    let today = local_day(now);
    let days = (today - HISTORY_DAYS + 1..=today)
        .map(|day| DayStats {
            day_start: day * DAY_MS - utc_offset_ms(day * DAY_MS),
            commits: cache.git.values().map(|entry| entry.stats.commits_by_day.get(&day).copied().unwrap_or(0)).sum(),
            agent_minutes: time.values().map(|agent| agent.seconds_by_day.get(&day).copied().unwrap_or(0)).sum::<u32>() / 60,
        })
        .collect();
    Empire { generated_at: now, repos: list, days }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

// Agent days start at local midnight, like the map's clock.
fn local_day(at_ms: i64) -> i64 {
    day_at(at_ms, utc_offset_ms(at_ms))
}

fn day_at(at_ms: i64, offset_ms: i64) -> i64 {
    (at_ms + offset_ms).div_euclid(DAY_MS)
}

/// The machine's offset from UTC at that instant (daylight saving included), in milliseconds.
fn utc_offset_ms(at_ms: i64) -> i64 {
    let at = at_ms.div_euclid(1000) as libc::time_t;
    // SAFETY: localtime_r only writes the tm we own; a null return leaves it unread.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&at, &mut tm) }.is_null() {
        return 0;
    }
    tm.tm_gmtoff as i64 * 1000
}

// ---------- Git: gold and wood ----------

fn git(repo: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").arg("-C").arg(repo).args(args).env("GIT_OPTIONAL_LOCKS", "0").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

fn read_git_stats(repo: &Path, now: i64) -> GitStats {
    let month = git(repo, &["log", "--since=30.days.ago", "--no-merges", "--numstat", "--format=%x00%ct"]).unwrap_or_default();
    let log = parse_log(&month, now);
    GitStats {
        commits_week: log.commits_week,
        lines_added_week: log.lines_added_week,
        commits_total: git(repo, &["rev-list", "--count", "HEAD"]).and_then(|text| text.trim().parse().ok()).unwrap_or(0),
        founded_at: git(repo, &["rev-list", "--max-parents=0", "--format=%ct", "HEAD"]).and_then(|text| earliest_root(&text)),
        commits_by_day: log.commits_by_day,
    }
}

#[derive(Debug, Default, PartialEq)]
struct LogSummary {
    commits_week: u32,
    lines_added_week: u64,
    commits_by_day: BTreeMap<i64, u32>,
}

// `git log --numstat --format=%x00%ct`: a NUL plus the commit time (epoch seconds) per commit,
// then "added<TAB>deleted<TAB>path" per file ("-" instead of numbers for a binary file).
fn parse_log(text: &str, now: i64) -> LogSummary {
    let mut summary = LogSummary::default();
    let mut is_this_week = false;
    for line in text.lines() {
        if let Some(seconds) = line.strip_prefix('\0') {
            let Ok(seconds) = seconds.trim().parse::<i64>() else { continue };
            let at = seconds * 1000;
            *summary.commits_by_day.entry(local_day(at)).or_insert(0) += 1;
            is_this_week = now - at <= WEEK_DAYS * DAY_MS;
            if is_this_week {
                summary.commits_week += 1;
            }
        } else if let Some(lines) = line.split('\t').next().and_then(|count| count.parse::<u64>().ok()) {
            if is_this_week {
                summary.lines_added_week += lines;
            }
        }
    }
    summary
}

// `git rev-list --max-parents=0 --format=%ct`: "commit <sha>" then its time, per root commit.
fn earliest_root(text: &str) -> Option<i64> {
    text.lines().filter_map(|line| line.trim().parse::<i64>().ok()).min().map(|seconds| seconds * 1000)
}

fn refresh_git(entries: &mut HashMap<PathBuf, GitEntry>, repos: &[Project], now: i64) {
    let stale: Vec<&Project> = repos
        .iter()
        .filter(|project| {
            entries.get(Path::new(&project.path)).is_none_or(|entry| entry.head_at != project.last_git_at || now - entry.read_at > GIT_TTL_MS)
        })
        .collect();
    let fresh: Vec<(&Project, GitStats)> = std::thread::scope(|scope| {
        let reads: Vec<_> = stale.iter().map(|project| scope.spawn(move || (*project, read_git_stats(Path::new(&project.path), now)))).collect();
        reads.into_iter().filter_map(|read| read.join().ok()).collect()
    });
    for (project, stats) in fresh {
        entries.insert(PathBuf::from(&project.path), GitEntry { head_at: project.last_git_at, read_at: now, stats });
    }
}

// ---------- Transcripts: food ----------

/// Agent time in each repository (the week, everything on disk, per day), by repository path.
fn agent_time_by_repo(scans: &mut HashMap<PathBuf, TranscriptScan>, repos: &[Project], now: i64, session_start: i64) -> HashMap<String, AgentTime> {
    let mut time: HashMap<String, AgentTime> = HashMap::new();
    let Some(root) = projects::claude_projects_dir() else { return time };
    let Ok(dirs) = fs::read_dir(&root) else { return time };
    let week_start = local_day(now) - (WEEK_DAYS - 1);
    let slugs: Vec<(String, &Project)> = repos.iter().map(|project| (project_slug(&project.path), project)).collect();
    let mut seen = HashSet::new();
    for dir in dirs.flatten() {
        let slug = dir.file_name().to_string_lossy().into_owned();
        let Some(project) = repo_for_slug(&slug, &slugs) else { continue };
        let Ok(files) = fs::read_dir(dir.path()) else { continue };
        for file in files.flatten() {
            let agent = time.entry(project.path.clone()).or_default();
            if let Some((path, len)) = transcript_file(&file) {
                let scan = scans.entry(path.clone()).or_default();
                scan.advance(&path, len);
                agent.week += scan.minutes_since(week_start);
                agent.total += scan.minutes_since(i64::MIN);
                agent.tokens_week += scan.tokens_since(week_start);
                agent.session.add(scan.spend_since(session_start));
                for (day, seconds) in &scan.seconds_by_day {
                    *agent.seconds_by_day.entry(*day).or_insert(0) += seconds;
                }
                seen.insert(path);
            } else if file.file_type().is_ok_and(|kind| kind.is_dir()) {
                // Task subagents write under their session: their tokens count, their time is
                // already the session's own.
                let Ok(subagents) = fs::read_dir(file.path().join("subagents")) else { continue };
                for (path, len) in subagents.flatten().filter_map(|sub| transcript_file(&sub)) {
                    let scan = scans.entry(path.clone()).or_default();
                    scan.advance(&path, len);
                    agent.tokens_week += scan.tokens_since(week_start);
                    agent.session.add(scan.spend_since(session_start));
                    seen.insert(path);
                }
            }
        }
    }
    scans.retain(|path, _| seen.contains(path)); // transcripts Claude Code deleted drop out
    time
}

fn transcript_file(entry: &fs::DirEntry) -> Option<(PathBuf, u64)> {
    let path = entry.path();
    let meta = entry.metadata().ok()?;
    (meta.is_file() && path.extension().and_then(|e| e.to_str()) == Some("jsonl")).then(|| (path, meta.len()))
}

// Sessions started in a subfolder (src-tauri) count for the repository; the deepest one wins.
pub(crate) fn repo_for_slug<'a>(slug: &str, repos: &[(String, &'a Project)]) -> Option<&'a Project> {
    repos
        .iter()
        .filter(|(repo, _)| slug == repo || slug.strip_prefix(repo.as_str()).is_some_and(|rest| rest.starts_with('-')))
        .max_by_key(|(repo, _)| repo.len())
        .map(|(_, project)| *project)
}

impl TranscriptScan {
    // Reads only what was appended since the last scan; a line still being written waits.
    fn advance(&mut self, path: &Path, len: u64) {
        if len < self.offset {
            *self = Self::default(); // rewritten from scratch
        }
        if len == self.offset {
            return;
        }
        let Ok(mut file) = File::open(path) else { return };
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut reader = BufReader::new(file);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(read) if read > 0 && line.last() == Some(&b'\n') => {
                    self.offset += read as u64;
                    if let Some(at) = line_timestamp(&line) {
                        self.add(at);
                        self.add_tokens(at, &line);
                    }
                }
                _ => break,
            }
        }
    }

    fn add(&mut self, at: i64) {
        if let Some(last) = self.last_at {
            let gap = at - last;
            if gap > 0 && gap <= ACTIVE_GAP_MS {
                *self.seconds_by_day.entry(local_day(at)).or_insert(0) += (gap / 1000) as u32;
            }
        }
        if self.last_at.is_none_or(|last| at > last) {
            self.last_at = Some(at);
        }
    }

    fn minutes_since(&self, first_day: i64) -> u32 {
        self.seconds_by_day.range(first_day..).map(|(_, seconds)| seconds).sum::<u32>() / 60
    }

    // Claude Code writes a reply once per content block, each line repeating its id and its usage
    // so far (the output keeps growing while it streams): a later line adds only what grew.
    fn add_tokens(&mut self, at: i64, line: &[u8]) {
        if !line.windows(USAGE_KEY.len()).any(|window| window == USAGE_KEY) {
            return;
        }
        let Ok(UsageEntry { message: Some(UsageMessage { id, usage: Some(usage) }) }) = serde_json::from_slice(line) else { return };
        let reply = usage.spend();
        let mut fresh = reply;
        if let Some(id) = id {
            if let Some((_, counted)) = self.recent_replies.iter_mut().find(|(seen, _)| *seen == id) {
                fresh = Spend { tokens: reply.tokens.saturating_sub(counted.tokens), weight: (reply.weight - counted.weight).max(0.0) };
                counted.add(fresh);
            } else {
                if self.recent_replies.len() == RECENT_MESSAGE_IDS {
                    self.recent_replies.pop_front();
                }
                self.recent_replies.push_back((id, reply));
            }
        }
        *self.tokens_by_day.entry(local_day(at)).or_insert(0) += fresh.tokens;
        let minute = at.div_euclid(MINUTE_MS);
        self.spend_by_minute.entry(minute).or_default().add(fresh);
        let oldest = minute - SESSION_WINDOW_MS / MINUTE_MS;
        while self.spend_by_minute.first_key_value().is_some_and(|(kept, _)| *kept < oldest) {
            self.spend_by_minute.pop_first();
        }
    }

    fn tokens_since(&self, first_day: i64) -> u64 {
        self.tokens_by_day.range(first_day..).map(|(_, tokens)| tokens).sum()
    }

    fn spend_since(&self, start_ms: i64) -> Spend {
        let mut spend = Spend::default();
        for (_, minute) in self.spend_by_minute.range(start_ms.div_euclid(MINUTE_MS)..) {
            spend.add(*minute);
        }
        spend
    }
}

// The entry's own timestamp sits after its message, near the end of the line: searching from the
// end skips the message, which may quote other timestamps.
fn line_timestamp(line: &[u8]) -> Option<i64> {
    let key = line.windows(TIMESTAMP_KEY.len()).rposition(|window| window == TIMESTAMP_KEY)?;
    let start = key + TIMESTAMP_KEY.len();
    parse_timestamp_ms(std::str::from_utf8(line.get(start..start + TIMESTAMP_LEN)?).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn at(text: &str) -> i64 {
        parse_timestamp_ms(text).unwrap()
    }

    #[test]
    fn log_counts_the_week_and_each_day_but_not_binaries() {
        let now = at("2026-10-02T15:00:00.000Z");
        let day_s = |text: &str| at(text) / 1000;
        let text = format!(
            "\0{}\n\n12\t3\tsrc/a.rs\n-\t-\tlogo.png\n\0{}\n\n5\t0\tREADME.md\n\0{}\n\n40\t0\told.rs\n",
            day_s("2026-10-02T12:00:00.000Z"),
            day_s("2026-10-02T13:00:00.000Z"),
            day_s("2026-09-20T12:00:00.000Z"),
        );
        let summary = parse_log(&text, now);
        assert_eq!((summary.commits_week, summary.lines_added_week), (2, 17)); // the old one counts only per day
        assert_eq!(summary.commits_by_day.get(&local_day(now)), Some(&2));
        assert_eq!(summary.commits_by_day.get(&local_day(at("2026-09-20T12:00:00.000Z"))), Some(&1));
        assert_eq!(parse_log("", now), LogSummary::default());
    }

    #[test]
    fn founding_is_the_earliest_root_commit() {
        let text = "commit aaa\n1737638074\ncommit bbb\n1600000000\n";
        assert_eq!(earliest_root(text), Some(1_600_000_000_000));
        assert_eq!(earliest_root(""), None);
    }

    #[test]
    fn timestamp_is_read_from_the_end_of_the_line() {
        let line = br#"{"message":{"content":"\"timestamp\":\"1999-01-01T00:00:00.000Z\""},"uuid":"x","timestamp":"2026-09-30T10:00:00.000Z","cwd":"/r"}"#;
        assert_eq!(line_timestamp(line), Some(at("2026-09-30T10:00:00.000Z")));
        assert_eq!(line_timestamp(br#"{"type":"summary"}"#), None);
    }

    #[test]
    fn active_time_counts_short_gaps_only_and_per_local_day() {
        let mut scan = TranscriptScan::default();
        for ts in ["2026-09-30T10:00:00.000Z", "2026-09-30T10:04:00.000Z", "2026-09-30T12:00:00.000Z", "2026-09-30T12:02:00.000Z"] {
            scan.add(at(ts));
        }
        let day = local_day(at("2026-09-30T10:00:00.000Z"));
        assert_eq!(scan.minutes_since(day), 6); // 4 + 2; the two-hour wait is not work
        assert_eq!(scan.minutes_since(day + 1), 0);
    }

    #[test]
    fn days_start_at_local_midnight() {
        let utc_minus_3 = -3 * 60 * 60 * 1000;
        // 01:30 UTC is still the previous day three hours west of Greenwich
        assert_eq!(day_at(at("2026-10-01T01:30:00.000Z"), utc_minus_3), day_at(at("2026-09-30T10:00:00.000Z"), utc_minus_3));
        assert_eq!(day_at(at("2026-10-01T03:00:00.000Z"), utc_minus_3), day_at(at("2026-09-30T10:00:00.000Z"), utc_minus_3) + 1);
    }

    #[test]
    fn transcripts_are_read_incrementally_and_wait_for_whole_lines() {
        let path = std::env::temp_dir().join(format!("cpo-empire-{}.jsonl", std::process::id()));
        let mut file = File::create(&path).unwrap();
        writeln!(file, r#"{{"uuid":"a","timestamp":"2026-09-30T10:00:00.000Z"}}"#).unwrap();
        write!(file, r#"{{"uuid":"b","timestamp":"2026-09-30T10:03:00.000Z""#).unwrap(); // still being written
        file.flush().unwrap();
        let mut scan = TranscriptScan::default();
        scan.advance(&path, fs::metadata(&path).unwrap().len());
        let day = local_day(at("2026-09-30T10:00:00.000Z"));
        assert_eq!(scan.minutes_since(day), 0);
        writeln!(file, "}}").unwrap();
        file.flush().unwrap();
        scan.advance(&path, fs::metadata(&path).unwrap().len());
        assert_eq!(scan.minutes_since(day), 3);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn tokens_count_each_reply_once_and_leave_cache_reads_out() {
        let path = std::env::temp_dir().join(format!("cpo-empire-tokens-{}.jsonl", std::process::id()));
        let reply = |id: &str, output: u32, minute: u32| {
            format!(
                r#"{{"message":{{"id":"{id}","role":"assistant","content":[],"usage":{{"input_tokens":3,"cache_creation_input_tokens":100,"cache_read_input_tokens":50000,"output_tokens":{output},"cache_creation":{{"ephemeral_5m_input_tokens":100}}}}}},"type":"assistant","timestamp":"2026-09-30T10:{minute:02}:00.000Z"}}"#
            )
        };
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{}", reply("msg_a", 20, 0)).unwrap(); // thinking block
        // a Task result carries its subagent's usage outside "message": that one is the subagent's
        writeln!(file, r#"{{"message":{{"role":"user","content":[]}},"toolUseResult":{{"usage":{{"input_tokens":9,"output_tokens":900}}}},"type":"user","timestamp":"2026-09-30T10:01:00.000Z"}}"#).unwrap();
        writeln!(file, "{}", reply("msg_a", 50, 1)).unwrap(); // tool_use block of the same reply, more output streamed
        writeln!(file, "{}", reply("msg_b", 20, 2)).unwrap();
        file.flush().unwrap();
        let mut scan = TranscriptScan::default();
        scan.advance(&path, fs::metadata(&path).unwrap().len());
        let day = local_day(at("2026-09-30T10:00:00.000Z"));
        assert_eq!(scan.tokens_since(day), (3 + 100 + 50) + (3 + 100 + 20));
        assert_eq!(scan.tokens_since(day + 1), 0);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn session_spend_weighs_cache_reads_and_keeps_only_a_window_back() {
        let path = std::env::temp_dir().join(format!("cpo-empire-session-{}.jsonl", std::process::id()));
        let reply = |id: &str, output: u32, time: &str| {
            format!(
                r#"{{"message":{{"id":"{id}","role":"assistant","content":[],"usage":{{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":{output}}}}},"type":"assistant","timestamp":"2026-09-30T{time}.000Z"}}"#
            )
        };
        let mut file = File::create(&path).unwrap();
        writeln!(file, "{}", reply("msg_a", 20, "10:00:00")).unwrap();
        writeln!(file, "{}", reply("msg_b", 20, "12:00:30")).unwrap();
        writeln!(file, "{}", reply("msg_b", 40, "12:00:40")).unwrap(); // same reply, more output streamed
        file.flush().unwrap();
        let mut scan = TranscriptScan::default();
        scan.advance(&path, fs::metadata(&path).unwrap().len());
        let since_noon = scan.spend_since(at("2026-09-30T12:00:00.000Z"));
        assert_eq!(since_noon.tokens, 10 + 100 + 40);
        assert!((since_noon.weight - (10.0 + 40.0 * OUTPUT_WEIGHT + 100.0 * CACHE_WRITE_WEIGHT + 1000.0 * CACHE_READ_WEIGHT)).abs() < 1e-9);
        assert_eq!(scan.spend_since(at("2026-09-30T09:00:00.000Z")).tokens, (10 + 100 + 20) + (10 + 100 + 40));
        // more than a window later, the 10:00 reply is gone
        writeln!(file, "{}", reply("msg_c", 0, "15:30:00")).unwrap();
        file.flush().unwrap();
        scan.advance(&path, fs::metadata(&path).unwrap().len());
        assert_eq!(scan.spend_since(at("2026-09-30T09:00:00.000Z")).tokens, (10 + 100 + 40) + (10 + 100));
        fs::remove_file(path).unwrap();
    }

    #[test]
    #[ignore = "reads this machine's ~/Code and ~/.claude; run with --ignored --nocapture"]
    fn live_empire_smoke() {
        for pass in ["cold", "warm"] {
            let started = std::time::Instant::now();
            let empire = empire(None);
            let explored = empire.repos.iter().filter(|r| r.is_explored).count();
            let hours: u32 = empire.repos.iter().map(|r| r.agent_minutes_week).sum::<u32>() / 60;
            let gold: u32 = empire.repos.iter().map(|r| r.commits_week).sum();
            let all_hours: u32 = empire.repos.iter().map(|r| r.agent_minutes_total).sum::<u32>() / 60;
            let month: u32 = empire.days.iter().map(|d| d.commits).sum();
            let tokens: u64 = empire.repos.iter().map(|r| r.tokens_week).sum();
            let session: u64 = empire.repos.iter().map(|r| r.tokens_session).sum();
            println!("{pass}: {:?} · {} repos, {explored} explored, {gold} commits, {hours} agent hours and {tokens} tokens this week ({session} in the last 5 h), {all_hours} agent hours on disk, {month} commits in 30 days", started.elapsed(), empire.repos.len());
        }
        assert!(!empire(None).repos.is_empty());
    }

    #[test]
    fn sessions_in_a_subfolder_count_for_the_deepest_repository() {
        let project = |name: &str, path: &str| Project {
            name: name.into(),
            path: path.into(),
            parent: String::new(),
            last_claude_at: None,
            last_git_at: None,
            tracked_files: None,
        };
        let (site, site_ui, app) = (project("site", "/c/site"), project("site-ui", "/c/site-ui"), project("app", "/c/app"));
        let slugs: Vec<(String, &Project)> = [&site, &site_ui, &app].iter().map(|p| (project_slug(&p.path), *p)).collect();
        assert_eq!(repo_for_slug("-c-site", &slugs).map(|p| p.name.as_str()), Some("site"));
        assert_eq!(repo_for_slug("-c-site-ui", &slugs).map(|p| p.name.as_str()), Some("site-ui"));
        assert_eq!(repo_for_slug("-c-app-src-tauri", &slugs).map(|p| p.name.as_str()), Some("app"));
        assert!(repo_for_slug("-c-other", &slugs).is_none());
    }
}
