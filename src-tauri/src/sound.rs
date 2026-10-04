//! Sound effects played natively. WebAudio inside WebKitGTK stays silent here (and WebKit pauses
//! audio for a hidden window, which is when agents usually finish), so the same 8-bit voices are
//! synthesized in Rust into a WAV once and handed to the system player (PipeWire first).

use std::f64::consts::TAU;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;

pub(crate) const RATE: u32 = 44_100;
const MASTER: f64 = 0.9;
const LOWPASS_HZ: f64 = 4800.0;
const ECHO_DELAY_S: f64 = 0.13;
const ECHO_FEEDBACK: f64 = 0.22;
const ECHO_MIX: f64 = 0.22;
const ECHO_TAIL_S: f64 = 0.6;
const ATTACK_S: f64 = 0.008;
const SILENCE: f64 = 0.0001;
pub(crate) const PLAYERS: [&str; 3] = ["pw-play", "paplay", "aplay"];

#[derive(Clone, Copy)]
enum Wave {
    Square,
    Triangle,
    Sine,
}

struct Voice {
    frequency: f64,
    start: f64,
    duration: f64,
    wave: Wave,
    volume: f64,
    /// Vibrato depth in Hz (6 Hz wobble), 0 for none.
    vibrato: f64,
}

const fn voice(frequency: f64, start: f64, duration: f64, wave: Wave, volume: f64) -> Voice {
    Voice { frequency, start, duration, wave, volume, vibrato: 0.0 }
}

/// Same score as playFinished in sfx.js: a harp sweep up, then a bell chord over a low C, like a
/// quest handed in. Soft waves only, to sit with the soundtrack (music.rs).
fn finished_score() -> Vec<Voice> {
    let mut voices: Vec<Voice> = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
        .iter()
        .enumerate()
        .map(|(i, &f)| voice(f, i as f64 * 0.045, 0.55, Wave::Triangle, 0.035))
        .collect();
    let chord = 0.3;
    voices.push(voice(261.63, chord, 0.8, Wave::Triangle, 0.07));
    voices.push(voice(783.99, chord, 0.9, Wave::Sine, 0.04));
    voices.push(voice(1046.5, chord, 1.1, Wave::Sine, 0.08));
    voices.push(voice(1046.5 * 2.76, chord, 0.3, Wave::Sine, 0.02)); // the bell's clang
    voices.push(voice(1318.51, chord + 0.04, 0.9, Wave::Sine, 0.045));
    voices.push(voice(2093.0, chord + 0.25, 0.35, Wave::Sine, 0.025));
    voices
}

/// Same as playAgeUp: a base advanced an era. Trumpet pickup, then a held major chord with vibrato.
fn age_up_score() -> Vec<Voice> {
    let mut voices: Vec<Voice> = [392.0, 523.25, 659.25]
        .iter()
        .enumerate()
        .map(|(i, &f)| voice(f, i as f64 * 0.11, 0.1, Wave::Square, 0.05))
        .collect();
    let chord = 0.36;
    voices.push(voice(261.63, chord, 0.9, Wave::Triangle, 0.08));
    voices.push(Voice { vibrato: 6.0, ..voice(783.99, chord, 0.95, Wave::Square, 0.035) });
    voices.push(Voice { vibrato: 6.0, ..voice(1046.5, chord, 1.0, Wave::Triangle, 0.06) });
    voices.push(voice(1318.51, chord + 0.12, 0.8, Wave::Triangle, 0.04));
    voices.push(voice(2093.0, chord + 0.5, 0.12, Wave::Sine, 0.025));
    voices
}

/// Same as playLimitReset: a plan limit reset, so a bugle sounds the charge (G C E G, E, G) to send
/// the villagers back to work. Square trumpets with vibrato on the held notes, over a low C.
fn limit_reset_score() -> Vec<Voice> {
    let mut voices: Vec<Voice> = [392.0, 523.25, 659.25]
        .iter()
        .enumerate()
        .map(|(i, &f)| voice(f, i as f64 * 0.12, 0.11, Wave::Square, 0.05))
        .collect();
    voices.push(Voice { vibrato: 5.0, ..voice(783.99, 0.36, 0.3, Wave::Square, 0.05) });
    voices.push(voice(659.25, 0.7, 0.12, Wave::Square, 0.05));
    let call = 0.84;
    voices.push(voice(261.63, call, 0.6, Wave::Triangle, 0.08));
    voices.push(Voice { vibrato: 5.0, ..voice(523.25, call, 0.6, Wave::Square, 0.025) });
    voices.push(Voice { vibrato: 5.0, ..voice(659.25, call, 0.6, Wave::Square, 0.025) });
    voices.push(Voice { vibrato: 5.0, ..voice(783.99, call, 0.6, Wave::Square, 0.05) });
    voices.push(voice(2093.0, call + 0.3, 0.12, Wave::Sine, 0.025));
    voices
}

/// Same as playAchievement: three rising sparkles.
fn achievement_score() -> Vec<Voice> {
    [1318.51, 1567.98, 2093.0]
        .iter()
        .enumerate()
        .map(|(i, &f)| voice(f, i as f64 * 0.08, 0.16, Wave::Triangle, 0.06))
        .collect()
}

/// Same as playNeedsYou: two descending "uh-oh" blips.
fn needs_you_score() -> Vec<Voice> {
    [0.0, 0.3]
        .iter()
        .flat_map(|&offset| [voice(739.99, offset, 0.1, Wave::Square, 0.07), voice(554.37, offset + 0.11, 0.14, Wave::Square, 0.07)])
        .collect()
}

fn envelope(voice: &Voice, t: f64) -> f64 {
    if t < ATTACK_S {
        return voice.volume * t / ATTACK_S;
    }
    // Exponential fall from full volume to near silence at the end of the note.
    let progress = (t - ATTACK_S) / (voice.duration - ATTACK_S).max(1e-6);
    voice.volume * (SILENCE / voice.volume).powf(progress.min(1.0))
}

fn synthesize(score: &[Voice]) -> Vec<f64> {
    let length = score.iter().map(|v| v.start + v.duration).fold(0.0, f64::max) + ECHO_TAIL_S;
    let mut mix = vec![0.0; (length * RATE as f64) as usize];
    let dt = 1.0 / RATE as f64;
    for voice in score {
        let first = (voice.start * RATE as f64) as usize;
        let count = (voice.duration * RATE as f64) as usize;
        let mut phase = 0.0;
        for n in 0..count {
            let t = n as f64 * dt;
            let frequency = voice.frequency + voice.vibrato * (TAU * 6.0 * t).sin();
            phase = (phase + frequency * dt).fract();
            let sample = match voice.wave {
                Wave::Square => {
                    if phase < 0.5 {
                        1.0
                    } else {
                        -1.0
                    }
                }
                Wave::Triangle => 4.0 * (phase - 0.5).abs() - 1.0,
                Wave::Sine => (TAU * phase).sin(),
            };
            if let Some(slot) = mix.get_mut(first + n) {
                *slot += sample * envelope(voice, t);
            }
        }
    }
    // One-pole low-pass, then a feedback echo mixed back in.
    let alpha = 1.0 - (-TAU * LOWPASS_HZ / RATE as f64).exp();
    let mut filtered = 0.0;
    let delay = (ECHO_DELAY_S * RATE as f64) as usize;
    let mut echo = vec![0.0; delay];
    let mut out = Vec::with_capacity(mix.len());
    for (i, dry) in mix.iter().enumerate() {
        filtered += alpha * (dry * MASTER - filtered);
        let slot = i % delay;
        let delayed = echo[slot];
        echo[slot] = filtered + delayed * ECHO_FEEDBACK;
        out.push(filtered + delayed * ECHO_MIX);
    }
    out
}

fn wav_bytes(samples: &[f64]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
    bytes.extend_from_slice(&RATE.to_le_bytes());
    bytes.extend_from_slice(&(RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&((sample.clamp(-1.0, 1.0) * i16::MAX as f64) as i16).to_le_bytes());
    }
    bytes
}

fn sound_path(name: &str) -> PathBuf {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    runtime.join("agent-of-empires").join(format!("{name}.wav"))
}

/// Writes the rendered sound as a WAV the first time this run asks for it (a new build may sound
/// different from the file an earlier run left behind) and returns its path.
pub(crate) fn rendered(name: &str, render: impl FnOnce() -> Vec<f64>) -> Result<PathBuf, String> {
    static WRITTEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let path = sound_path(name);
    let is_written = |written: &Mutex<Vec<String>>| written.lock().is_ok_and(|names| names.iter().any(|n| n == name));
    if is_written(&WRITTEN) {
        return Ok(path);
    }
    // Rendered without holding the lock: a song takes a moment, and an effect must not wait for it.
    fs::create_dir_all(path.parent().unwrap_or(&path)).map_err(|err| err.to_string())?;
    // Written aside, then renamed in: songs skipped through fast can render the same file twice at
    // once, and the player must never read one half rewritten.
    static STAGED: AtomicUsize = AtomicUsize::new(0);
    let staging = path.with_extension(format!("wav.{}", STAGED.fetch_add(1, Ordering::Relaxed)));
    let saved = fs::write(&staging, wav_bytes(&render())).and_then(|()| fs::rename(&staging, &path));
    saved.map_err(|err| format!("Não consegui gravar o som: {err}"))?;
    if let Ok(mut names) = WRITTEN.lock() {
        names.push(name.to_string());
    }
    Ok(path)
}

/// Renders the effect (once per run) and plays it on a background thread.
pub fn play(name: &str) -> Result<(), String> {
    let score = match name {
        "finished" => finished_score(),
        "needs_you" => needs_you_score(),
        "age_up" => age_up_score(),
        "achievement" => achievement_score(),
        "limit_reset" => limit_reset_score(),
        _ => return Err(format!("Som desconhecido: {name}")),
    };
    let path = rendered(name, || synthesize(&score))?;
    thread::spawn(move || {
        let played = PLAYERS.iter().any(|player| {
            Command::new(player)
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        });
        if !played {
            eprintln!("[sound] no player could play {}", path.display());
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effects_are_audible_short_and_never_clip() {
        for (name, score) in [("finished", finished_score()), ("needs_you", needs_you_score()), ("limit_reset", limit_reset_score())] {
            let samples = synthesize(&score);
            let peak = samples.iter().fold(0.0f64, |m, s| m.max(s.abs()));
            let audible = samples.iter().rposition(|s| s.abs() > 0.002).unwrap_or(0) as f64 / RATE as f64;
            assert!(peak > 0.03 && peak < 0.95, "{name}: peak {peak}");
            assert!(audible > 0.3 && audible < 1.5, "{name}: audible for {audible}s");
        }
    }

    #[test]
    #[ignore = "plays audio on this machine; run with --ignored"]
    fn plays_the_finished_effect_through_the_system_player() {
        play("finished").unwrap();
        thread::sleep(std::time::Duration::from_secs(2));
        assert!(sound_path("finished").exists());
    }

    #[test]
    fn wav_header_matches_the_samples() {
        let bytes = wav_bytes(&[0.0, 0.5, -0.5]);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 6);
        assert_eq!(bytes.len(), 44 + 6);
    }
}
