//! Background music: five original town themes in the spirit of the Ragnarok Online soundtrack,
//! one per base style (Prontera, Geffen, Payon, Morroc, Aldebaran). They are written here as notes,
//! synthesized like the sound effects and looped by the system player while the window is shown.

use crate::sound;
use std::f64::consts::TAU;
use std::fs;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread;
use std::time::Duration;

const RATE: f64 = sound::RATE as f64;
/// Loudness of the mix: the soundtrack sits under the sound effects.
const MUSIC_RMS: f64 = 0.045;
/// The last loop's echoes ring out before the file ends, fading over its last part.
const TAIL_S: f64 = 2.5;
const FADE_OUT_S: f64 = 1.5;
const PLAYER_POLL: Duration = Duration::from_millis(100);
/// The volume slider tops out at 150%: the mix peaks under 0.6, so even that never clips.
const MAX_VOLUME: f64 = 1.5;
/// The WAV header sound.rs writes before the samples.
const WAV_HEADER_BYTES: usize = 44;
const CHUNK_BYTES: usize = 4096;
/// The pipe to the player holds ~0.2 s of audio, so a volume change or a stop is heard that soon.
const PIPE_BYTES: libc::c_int = 16 * 1024;
/// Lowest note of a voiced chord (G3) and of a bass note (D2).
const VOICE_LOW: i32 = 55;
const BASS_LOW: i32 = 38;
/// In an accompaniment step, plays the chord's bass note instead of a chord tone.
const BASS: i32 = -1;

const TABLE_SIZE: usize = 4096;
const SAW_HARMONICS: usize = 6;
const VIBRATO_HZ: f64 = 5.2;
const VIBRATO_DEPTH: f64 = 0.005;
const PLUCK_ATTACK_S: f64 = 0.003;
const PLUCK_DAMP_S: f64 = 0.25;
const STRINGS_DETUNE_CENTS: [f64; 3] = [-7.0, 0.0, 7.0];

const COMB_DELAYS: [usize; 4] = [1557, 1617, 1491, 1422];
const ALLPASS_DELAYS: [usize; 2] = [556, 441];
const COMB_FEEDBACK: f64 = 0.78;
const COMB_DAMP: f64 = 0.3;
const ALLPASS_FEEDBACK: f64 = 0.5;
const REVERB_MIX: f64 = 0.3;

/// Partials of a plucked or struck note: (frequency ratio, level, decay per second).
type Partials = &'static [(f64, f64, f64)];
const HARP: Partials = &[(1.0, 1.0, 1.8), (2.0, 0.45, 3.2), (3.0, 0.2, 4.8), (4.0, 0.1, 6.5), (5.0, 0.05, 8.5)];
const KOTO: Partials = &[(1.0, 1.0, 2.6), (2.0, 0.7, 3.8), (3.0, 0.45, 5.5), (4.0, 0.3, 7.5), (5.0, 0.18, 9.5), (6.0, 0.1, 12.0)];
const OUD: Partials = &[(1.0, 1.0, 3.5), (2.0, 0.85, 4.5), (3.0, 0.55, 6.0), (4.0, 0.4, 8.0), (5.0, 0.25, 10.0), (6.0, 0.15, 13.0)];
/// A music box tine: its upper partials are slightly out of tune with the note, like a bell.
const BELL: Partials = &[(1.0, 1.0, 1.4), (2.0, 0.25, 2.4), (3.0, 0.1, 3.4), (4.16, 0.16, 5.0), (5.43, 0.07, 7.5)];

#[derive(Clone, Copy)]
enum Instrument {
    Flute,
    Strings,
    Bass,
    Harp,
    Koto,
    Oud,
    Bell,
    /// Goblet drum: the low "dum" and the dry "tek".
    Dum,
    Tek,
    /// Aldebaran's clock tower.
    Tick,
}

struct Note {
    instrument: Instrument,
    midi: i32,
    beat: f64,
    beats: f64,
    volume: f64,
}

/// A chord as played: the bass note and the chord tones from VOICE_LOW up.
struct Chord {
    bass: i32,
    tones: Vec<i32>,
}

impl Chord {
    /// Chord tone by index, going up an octave past the last one (0, 1, 2 = triad, 3 = root above).
    fn tone(&self, index: usize) -> i32 {
        self.tones[index % self.tones.len()] + 12 * (index / self.tones.len()) as i32
    }
}

/// (beat in the bar, chord tone index or BASS, beats it rings, volume), repeated on every chord.
type Step = (f64, i32, f64, f64);

struct Track {
    name: &'static str,
    seconds_per_beat: f64,
    beats_per_bar: f64,
    bars: usize,
    loops: usize,
    notes: Vec<Note>,
}

impl Track {
    fn new(name: &'static str, bpm: f64, beats_per_bar: f64, bars: usize, loops: usize) -> Self {
        Track { name, seconds_per_beat: 60.0 / bpm, beats_per_bar, bars, loops, notes: Vec::new() }
    }

    /// Notes one after another: "E5:1.5" plays E5 for 1.5 beats, "-:1" rests a beat, "|" ends a bar.
    fn melody(&mut self, instrument: Instrument, volume: f64, tune: &str) {
        let mut beat = 0.0;
        for (bar, text) in tune.split('|').enumerate() {
            let bar_start = beat;
            for token in text.split_whitespace() {
                let (pitch, beats) = token.split_once(':').unwrap_or_else(|| panic!("{}: bad token {token}", self.name));
                let beats: f64 = beats.parse().unwrap_or_else(|_| panic!("{}: bad length in {token}", self.name));
                if pitch != "-" {
                    self.notes.push(Note { instrument, midi: midi(pitch), beat, beats, volume });
                }
                beat += beats;
            }
            assert!((beat - bar_start - self.beats_per_bar).abs() < 1e-9, "{}: bar {} is not full", self.name, bar + 1);
        }
        assert_eq!(beat, self.bars as f64 * self.beats_per_bar, "{}: tune length", self.name);
    }

    /// One bar per chord, each playing the same steps.
    fn accompany(&mut self, chords: &[&str], instrument: Instrument, transpose: i32, steps: &[Step]) {
        assert_eq!(chords.len(), self.bars, "{}: one chord per bar", self.name);
        for (bar, symbol) in chords.iter().enumerate() {
            let chord = chord(symbol);
            for &(beat, tone, beats, volume) in steps {
                let pitch = if tone == BASS { chord.bass } else { chord.tone(tone as usize) };
                let beat = bar as f64 * self.beats_per_bar + beat;
                self.notes.push(Note { instrument, midi: pitch + transpose, beat, beats, volume });
            }
        }
    }

    /// Unpitched hits, the same in every bar: (beat in the bar, volume).
    fn rhythm(&mut self, instrument: Instrument, hits: &[(f64, f64)]) {
        for bar in 0..self.bars {
            for &(beat, volume) in hits {
                let beat = bar as f64 * self.beats_per_bar + beat;
                self.notes.push(Note { instrument, midi: 0, beat, beats: 0.0, volume });
            }
        }
    }

    fn loop_seconds(&self) -> f64 {
        self.bars as f64 * self.beats_per_bar * self.seconds_per_beat
    }
}

/// The capital: a bright waltz on flute over a harp, in G major.
fn prontera() -> Track {
    const CHORDS: [&str; 32] = [
        "G", "D/F#", "Em", "C", "G", "Am", "D", "D7", "G", "D/F#", "Em", "C", "Am", "D", "G", "G", //
        "C", "D", "Bm", "Em", "Am", "D", "G", "G", "C", "D", "Bm", "Em", "Am", "D7", "G", "G",
    ];
    const TUNE: &str = "D5:1 G5:1 B5:1 | A5:2 F#5:1 | G5:1.5 F#5:0.5 E5:1 | E5:2 D5:1 |
        B4:1.5 C5:0.5 D5:1 | E5:1.5 D5:0.5 C5:1 | D5:1 F#5:1 A5:1 | A5:3 |
        D5:1 G5:1 B5:1 | D6:2 A5:1 | B5:1.5 A5:0.5 G5:1 | E6:2 D6:0.5 C6:0.5 |
        C6:1.5 B5:0.5 A5:1 | A5:1 B5:0.5 A5:0.5 F#5:1 | G5:3 | -:2 D5:1 |
        E5:2 G5:1 | F#5:2 A5:1 | B5:1.5 A5:0.5 F#5:1 | G5:2 E5:1 |
        A5:1.5 B5:0.5 C6:1 | D6:1.5 C6:0.5 A5:1 | B5:2 G5:1 | G5:2 A5:0.5 B5:0.5 |
        C6:2 G5:1 | A5:1.5 B5:0.5 C6:1 | D6:2 B5:1 | G5:1.5 A5:0.5 B5:1 |
        C6:1 B5:1 A5:1 | F#5:1 A5:1 C6:1 | B5:2 A5:1 | G5:3";
    let mut track = Track::new("prontera", 150.0, 3.0, CHORDS.len(), 2);
    track.melody(Instrument::Flute, 0.2, TUNE);
    let arpeggio: Vec<Step> = [0, 1, 2, 3, 2, 1].iter().enumerate().map(|(i, &tone)| (i as f64 * 0.5, tone, 3.0 - i as f64 * 0.5, 0.1)).collect();
    track.accompany(&CHORDS, Instrument::Harp, 0, &arpeggio);
    track.accompany(&CHORDS, Instrument::Strings, 0, &[(0.0, 0, 3.0, 0.035), (0.0, 1, 3.0, 0.035), (0.0, 2, 3.0, 0.035)]);
    track.accompany(&CHORDS, Instrument::Bass, 0, &[(0.0, BASS, 2.5, 0.16)]);
    track.rhythm(Instrument::Dum, &[(0.0, 0.07)]);
    track
}

/// The magic city: a slow, misty E dorian with a music box turning over the strings.
fn geffen() -> Track {
    const CHORDS: [&str; 16] = ["Em", "A", "Em", "A", "Cmaj7", "D", "Em", "Bsus4", "Cmaj7", "D", "Bm", "Em", "Am", "D", "Bsus4", "B7"];
    const TUNE: &str = "B4:3 E5:1 | E5:2 C#5:1 A4:1 | G4:1.5 A4:0.5 B4:2 | C#5:3 -:1 |
        E5:1 G5:1 B5:2 | A5:3 F#5:1 | G5:1.5 F#5:0.5 E5:2 | F#5:3 -:1 |
        B5:2 G5:1 E5:1 | F#5:1 A5:1 D6:2 | D6:1.5 C#6:0.5 B5:2 | G5:3 -:1 |
        A5:1 C6:1 E6:2 | D6:1.5 C6:0.5 A5:2 | B5:2 E5:2 | F#5:2 D#5:2";
    let mut track = Track::new("geffen", 84.0, 4.0, CHORDS.len(), 2);
    track.melody(Instrument::Flute, 0.16, TUNE);
    let music_box: Vec<Step> = [0, 1, 2, 3, 4, 3, 2, 1].iter().enumerate().map(|(i, &tone)| (i as f64 * 0.5, tone, 1.5, 0.07)).collect();
    track.accompany(&CHORDS, Instrument::Bell, 12, &music_box);
    track.accompany(&CHORDS, Instrument::Strings, 0, &[(0.0, 0, 4.0, 0.045), (0.0, 1, 4.0, 0.045), (0.0, 2, 4.0, 0.045)]);
    track.accompany(&CHORDS, Instrument::Bass, 0, &[(0.0, BASS, 4.0, 0.13)]);
    track
}

/// The mountain village: a pentatonic flute over a rolling koto and a light hand drum.
fn payon() -> Track {
    const CHORDS: [&str; 16] = ["Dm", "Dm", "F", "Csus2", "Dm", "Dm", "Gsus4", "Dm", "F", "F", "Csus2", "Dm", "Gsus4", "Gsus4", "Csus2", "Dm"];
    const TUNE: &str = "A4:1.5 C5:0.5 D5:2 | F5:1.5 G5:0.5 F5:1 D5:1 | C5:1.5 D5:0.5 F5:2 | G5:3 -:1 |
        A5:1.5 G5:0.5 F5:1 D5:1 | F5:1 G5:1 A5:2 | G5:1.5 F5:0.5 D5:1 C5:1 | D5:3 -:1 |
        F5:1.5 G5:0.5 A5:1 C6:1 | A5:3 G5:1 | G5:1.5 A5:0.5 G5:1 D5:1 | F5:2 D5:2 |
        C5:1.5 D5:0.5 G5:2 | F5:1.5 G5:0.5 D5:2 | C5:1.5 D5:0.5 C5:1 A4:1 | D5:3 -:1";
    let mut track = Track::new("payon", 92.0, 4.0, CHORDS.len(), 2);
    track.melody(Instrument::Flute, 0.18, TUNE);
    let koto: Vec<Step> = [0, 2, 3, 2, 1, 3, 4, 3].iter().enumerate().map(|(i, &tone)| (i as f64 * 0.5, tone, 1.0, 0.09)).collect();
    track.accompany(&CHORDS, Instrument::Koto, 0, &koto);
    track.accompany(&CHORDS, Instrument::Koto, 0, &[(0.0, BASS, 2.0, 0.14), (2.0, BASS, 2.0, 0.1)]);
    track.accompany(&CHORDS, Instrument::Strings, 0, &[(0.0, 0, 4.0, 0.025), (0.0, 2, 4.0, 0.025)]);
    track.rhythm(Instrument::Dum, &[(0.0, 0.1), (2.5, 0.07)]);
    track.rhythm(Instrument::Tek, &[(1.0, 0.035), (1.5, 0.025), (3.0, 0.035)]);
    track
}

/// The desert city: a D hijaz line over an oud and the goblet drum's maqsum rhythm.
fn morroc() -> Track {
    const CHORDS: [&str; 16] = ["D", "D", "Eb", "D", "Gm", "Gm", "Eb", "D", "D", "D", "Cm", "Cm", "Gm", "Eb", "D", "D"];
    const TUNE: &str = "D5:1 Eb5:1 F#5:1.5 G5:0.5 | A5:2 G5:0.5 F#5:0.5 Eb5:1 | G5:1.5 F#5:0.5 Eb5:1 D5:1 | D5:3 -:1 |
        G5:1 Bb5:1 A5:1 G5:1 | Bb5:1.5 C6:0.5 Bb5:1 A5:1 | G5:1 F#5:0.5 G5:0.5 Eb5:2 | D5:3 -:1 |
        A5:1.5 Bb5:0.5 A5:1 G5:1 | F#5:1 G5:1 A5:2 | G5:1.5 F#5:0.5 Eb5:1 C5:1 | Eb5:2 D5:1 C5:1 |
        D5:1 G5:1 Bb5:1 A5:1 | G5:1.5 F#5:0.5 Eb5:2 | D5:1 Eb5:0.5 D5:0.5 C5:1 D5:1 | D5:3 -:1";
    let mut track = Track::new("morroc", 100.0, 4.0, CHORDS.len(), 2);
    track.melody(Instrument::Flute, 0.18, TUNE);
    let oud: [Step; 6] = [(0.0, 0, 1.0, 0.11), (0.5, 2, 0.5, 0.07), (1.5, 1, 0.5, 0.08), (2.0, 0, 1.0, 0.1), (3.0, 2, 0.5, 0.08), (3.5, 1, 0.5, 0.06)];
    track.accompany(&CHORDS, Instrument::Oud, -12, &oud);
    track.accompany(&CHORDS, Instrument::Bass, 0, &[(0.0, BASS, 4.0, 0.12)]);
    track.accompany(&CHORDS, Instrument::Strings, 0, &[(0.0, 0, 4.0, 0.025), (0.0, 1, 4.0, 0.025)]);
    track.rhythm(Instrument::Dum, &[(0.0, 0.16), (2.0, 0.13)]);
    track.rhythm(Instrument::Tek, &[(0.5, 0.06), (1.5, 0.06), (3.0, 0.07), (3.5, 0.035)]);
    track
}

/// The clock tower town: a music box waltz in F, with the clock ticking along.
fn aldebaran() -> Track {
    const CHORDS: [&str; 16] = ["F", "C/E", "Dm", "Am", "Bb", "F/A", "Gm7", "C7", "F", "C/E", "Dm", "Bb", "Gm7", "C7", "F", "F"];
    const TUNE: &str = "C6:1 A5:1 F5:1 | G5:1.5 A5:0.5 G5:1 | F5:1 A5:1 D6:1 | C6:2 A5:1 |
        D6:1 C6:1 Bb5:1 | A5:1.5 G5:0.5 F5:1 | G5:1.5 A5:0.5 Bb5:1 | C6:2 -:1 |
        F6:1 E6:1 C6:1 | D6:1.5 C6:0.5 G5:1 | A5:1 D6:1 F6:1 | F6:1.5 E6:0.5 D6:1 |
        D6:1 Bb5:1 G5:1 | E5:1 G5:1 Bb5:1 | A5:1.5 G5:0.5 F5:1 | F5:2 -:1";
    let mut track = Track::new("aldebaran", 126.0, 3.0, CHORDS.len(), 3);
    track.melody(Instrument::Bell, 0.16, TUNE);
    let waltz: [Step; 7] = [(0.0, BASS, 1.0, 0.13), (1.0, 0, 0.8, 0.05), (1.0, 1, 0.8, 0.05), (1.0, 2, 0.8, 0.05), (2.0, 0, 0.8, 0.04), (2.0, 1, 0.8, 0.04), (2.0, 2, 0.8, 0.04)];
    track.accompany(&CHORDS, Instrument::Harp, 0, &waltz);
    track.accompany(&CHORDS, Instrument::Strings, 0, &[(0.0, 0, 3.0, 0.02), (0.0, 1, 3.0, 0.02), (0.0, 2, 3.0, 0.02)]);
    track.rhythm(Instrument::Tick, &[(0.0, 0.03), (1.0, 0.018), (2.0, 0.018)]);
    track
}

const PLAYLIST: [fn() -> Track; 5] = [prontera, geffen, payon, morroc, aldebaran];

/// Semitone of a note name without octave: "C" 0, "F#" 6, "Bb" 10.
fn pitch_class(name: &str) -> i32 {
    let mut chars = name.chars();
    let letter = match chars.next() {
        Some('C') => 0,
        Some('D') => 2,
        Some('E') => 4,
        Some('F') => 5,
        Some('G') => 7,
        Some('A') => 9,
        Some('B') => 11,
        _ => panic!("bad note name {name}"),
    };
    letter
        + chars
            .map(|accidental| match accidental {
                '#' => 1,
                'b' => -1,
                _ => panic!("bad accidental in {name}"),
            })
            .sum::<i32>()
}

/// MIDI number of a note: "A4" 69, "C#5" 73, "Bb3" 58.
fn midi(note: &str) -> i32 {
    let split = note.find(|c: char| c.is_ascii_digit()).unwrap_or_else(|| panic!("note without octave: {note}"));
    let octave: i32 = note[split..].parse().unwrap_or_else(|_| panic!("bad octave in {note}"));
    12 * (octave + 1) + pitch_class(&note[..split])
}

/// The note of this pitch class at or just above `low`.
fn at_or_above(pitch_class: i32, low: i32) -> i32 {
    low + (pitch_class - low).rem_euclid(12)
}

/// "G", "Em", "D7", "Cmaj7", "Bsus4", "D/F#" → its bass note and chord tones.
fn chord(symbol: &str) -> Chord {
    let (name, slash) = symbol.split_once('/').map_or((symbol, None), |(name, bass)| (name, Some(bass)));
    let root_len = if name[1..].starts_with(['#', 'b']) { 2 } else { 1 };
    let root = pitch_class(&name[..root_len]);
    let intervals: &[i32] = match &name[root_len..] {
        "" => &[0, 4, 7],
        "m" => &[0, 3, 7],
        "7" => &[0, 4, 7, 10],
        "m7" => &[0, 3, 7, 10],
        "maj7" => &[0, 4, 7, 11],
        "sus2" => &[0, 2, 7],
        "sus4" => &[0, 5, 7],
        quality => panic!("unknown chord quality {quality} in {symbol}"),
    };
    let mut tones: Vec<i32> = intervals.iter().map(|interval| at_or_above(root + interval, VOICE_LOW)).collect();
    tones.sort_unstable();
    let bass = at_or_above(slash.map_or(root, pitch_class), BASS_LOW);
    Chord { bass, tones }
}

fn frequency(midi: i32) -> f64 {
    440.0 * 2f64.powf((midi - 69) as f64 / 12.0)
}

fn sample_count(seconds: f64) -> usize {
    (seconds * RATE) as usize
}

/// One cycle of a band-limited saw with this many harmonics (1 = a sine), peak 1.
fn wavetable(harmonics: usize) -> Vec<f64> {
    let mut table: Vec<f64> = (0..=TABLE_SIZE)
        .map(|i| {
            let x = i as f64 / TABLE_SIZE as f64;
            (1..=harmonics).map(|h| (TAU * h as f64 * x).sin() / h as f64).sum()
        })
        .collect();
    let peak = table.iter().fold(0.0f64, |m, s| m.max(s.abs()));
    table.iter_mut().for_each(|s| *s /= peak);
    table
}

fn lookup(table: &[f64], phase: f64) -> f64 {
    // Truncating through an integer wraps the phase far faster than rem_euclid (a libm call).
    let mut wrapped = phase - (phase as i64) as f64;
    if wrapped < 0.0 {
        wrapped += 1.0;
    }
    let position = wrapped * TABLE_SIZE as f64;
    let index = (position as usize).min(TABLE_SIZE - 1);
    let fraction = position - index as f64;
    table[index] + (table[index + 1] - table[index]) * fraction
}

/// Table sine, phase in cycles: thousands of notes would spend seconds in f64::sin.
fn sine(phase: f64) -> f64 {
    static TABLE: OnceLock<Vec<f64>> = OnceLock::new();
    lookup(TABLE.get_or_init(|| wavetable(1)), phase)
}

fn saw(phase: f64) -> f64 {
    static TABLE: OnceLock<Vec<f64>> = OnceLock::new();
    lookup(TABLE.get_or_init(|| wavetable(SAW_HARMONICS)), phase)
}

/// Deterministic white noise (xorshift), so a track renders the same every time.
struct Noise(u64);

impl Noise {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }
}

/// Rises over `attack`, holds while the note is held, then falls away over `release`.
fn sustain_envelope(t: f64, held: f64, attack: f64, release: f64) -> f64 {
    if t < attack {
        return t / attack;
    }
    if t < held {
        return 1.0;
    }
    (1.0 - (t - held) / release).max(0.0).powi(2)
}

/// Breathy sine with a few harmonics; the vibrato leans in on held notes, as a player would.
fn flute(frequency: f64, seconds: f64, noise: &mut Noise) -> Vec<f64> {
    let mut phase = 0.0;
    let mut breath = 0.0;
    (0..sample_count(seconds + 0.12))
        .map(|n| {
            let t = n as f64 / RATE;
            let depth = VIBRATO_DEPTH * ((t - 0.2) / 0.3).clamp(0.0, 1.0);
            phase += frequency * (1.0 + depth * sine(VIBRATO_HZ * t)) / RATE;
            // Slow noise riding on the note puts the breath around its pitch, not under it.
            breath += 0.03 * (noise.next() - breath);
            let tone = sine(phase) * (1.0 + 1.5 * breath) + 0.22 * sine(2.0 * phase) + 0.07 * sine(3.0 * phase);
            tone * sustain_envelope(t, seconds, 0.05, 0.12)
        })
        .collect()
}

/// Three slightly detuned saws swelling in: the string section under the tune.
fn strings(frequency: f64, seconds: f64) -> Vec<f64> {
    let ratios = STRINGS_DETUNE_CENTS.map(|cents| 2f64.powf(cents / 1200.0));
    let mut phases = [0.0, 0.33, 0.67];
    (0..sample_count(seconds + 0.6))
        .map(|n| {
            let t = n as f64 / RATE;
            let mut sum = 0.0;
            for (phase, ratio) in phases.iter_mut().zip(ratios) {
                *phase += frequency * ratio / RATE;
                sum += saw(*phase);
            }
            sum / 3.0 * sustain_envelope(t, seconds, 0.35, 0.6)
        })
        .collect()
}

/// Round low note that settles a little after the attack.
fn bass(frequency: f64, seconds: f64) -> Vec<f64> {
    let mut phase = 0.0;
    (0..sample_count(seconds + 0.15))
        .map(|n| {
            let t = n as f64 / RATE;
            phase += frequency / RATE;
            let settle = 0.7 + 0.3 * (-t * 5.0).exp();
            let tone = sine(phase) + 0.3 * sine(2.0 * phase) + 0.1 * sine(3.0 * phase);
            tone * settle * sustain_envelope(t, seconds, 0.015, 0.15)
        })
        .collect()
}

/// Each partial rings and dies away (the high ones first); the note is damped when it ends.
/// `bend` starts the pitch that much sharp and lets it settle, like a koto string pressed.
fn pluck(frequency: f64, seconds: f64, partials: Partials, bend: f64) -> Vec<f64> {
    let audible: Vec<_> = partials.iter().filter(|(ratio, _, _)| ratio * frequency < RATE * 0.45).collect();
    let total: f64 = audible.iter().map(|(_, level, _)| level).sum();
    let mut levels: Vec<f64> = audible.iter().map(|(_, level, _)| level / total).collect();
    let falloffs: Vec<f64> = audible.iter().map(|(_, _, decay)| (-decay / RATE).exp()).collect();
    let bend_falloff = (-25.0 / RATE).exp();
    let mut bend = bend;
    let mut phase = 0.0;
    (0..sample_count(seconds + PLUCK_DAMP_S))
        .map(|n| {
            let t = n as f64 / RATE;
            phase += frequency * (1.0 + bend) / RATE;
            bend *= bend_falloff;
            let mut sum = 0.0;
            for ((&(ratio, _, _), level), falloff) in audible.iter().zip(levels.iter_mut()).zip(&falloffs) {
                sum += *level * sine(ratio * phase);
                *level *= falloff;
            }
            let attack = (t / PLUCK_ATTACK_S).min(1.0);
            let damp = (1.0 - (t - seconds).max(0.0) / PLUCK_DAMP_S).max(0.0);
            sum * attack * damp
        })
        .collect()
}

/// Low drum hit: the pitch drops as the skin settles.
fn dum() -> Vec<f64> {
    let mut phase = 0.0;
    (0..sample_count(0.45))
        .map(|n| {
            let t = n as f64 / RATE;
            phase += (55.0 + 95.0 * (-t * 18.0).exp()) / RATE;
            sine(phase) * (-t * 7.0).exp() * (t / PLUCK_ATTACK_S).min(1.0)
        })
        .collect()
}

/// Short burst of high noise: a rim hit, or a clock's tick when `click` adds its metallic ping.
fn tek(noise: &mut Noise, decay: f64, click: f64) -> Vec<f64> {
    let mut low = 0.0;
    (0..sample_count(5.0 / decay))
        .map(|n| {
            let t = n as f64 / RATE;
            let white = noise.next();
            low += 0.25 * (white - low);
            ((white - low) + click * sine(2400.0 * t)) * (-t * decay).exp()
        })
        .collect()
}

fn synthesize(note: &Note, seconds: f64, noise: &mut Noise) -> Vec<f64> {
    let frequency = frequency(note.midi);
    match note.instrument {
        Instrument::Flute => flute(frequency, seconds, noise),
        Instrument::Strings => strings(frequency, seconds),
        Instrument::Bass => bass(frequency, seconds),
        Instrument::Harp => pluck(frequency, seconds, HARP, 0.0),
        Instrument::Koto => pluck(frequency, seconds, KOTO, 0.012),
        Instrument::Oud => pluck(frequency, seconds, OUD, 0.004),
        Instrument::Bell => pluck(frequency, seconds, BELL, 0.0),
        Instrument::Dum => dum(),
        Instrument::Tek => tek(noise, 60.0, 0.0),
        Instrument::Tick => tek(noise, 120.0, 0.8),
    }
}

/// Every loop of the track, mixed, with its echoes left to ring out.
fn render(track: &Track) -> Vec<f64> {
    let loop_seconds = track.loop_seconds();
    let mut mix = vec![0.0; sample_count(loop_seconds * track.loops as f64 + TAIL_S)];
    let mut noise = Noise(0x9E37_79B9_7F4A_7C15);
    for repeat in 0..track.loops {
        for note in &track.notes {
            let start = repeat as f64 * loop_seconds + note.beat * track.seconds_per_beat;
            let first = sample_count(start).min(mix.len());
            for (slot, sample) in mix[first..].iter_mut().zip(synthesize(note, note.beats * track.seconds_per_beat, &mut noise)) {
                *slot += sample * note.volume;
            }
        }
    }
    master(&mix)
}

/// A small hall (Schroeder reverb: parallel damped combs into allpasses) mixed over the dry signal.
fn reverb(dry: &[f64]) -> Vec<f64> {
    let mut combs: Vec<(Vec<f64>, f64)> = COMB_DELAYS.iter().map(|&delay| (vec![0.0; delay], 0.0)).collect();
    let mut allpasses: Vec<Vec<f64>> = ALLPASS_DELAYS.iter().map(|&delay| vec![0.0; delay]).collect();
    let mut out = Vec::with_capacity(dry.len());
    for (i, &sample) in dry.iter().enumerate() {
        let mut wet = 0.0;
        for (buffer, damped) in combs.iter_mut() {
            let slot = i % buffer.len();
            let delayed = buffer[slot];
            *damped = delayed * (1.0 - COMB_DAMP) + *damped * COMB_DAMP;
            buffer[slot] = sample + *damped * COMB_FEEDBACK;
            wet += delayed;
        }
        wet /= combs.len() as f64;
        for buffer in allpasses.iter_mut() {
            let slot = i % buffer.len();
            let delayed = buffer[slot];
            buffer[slot] = wet + delayed * ALLPASS_FEEDBACK;
            wet = delayed - wet;
        }
        out.push(sample + wet * REVERB_MIX);
    }
    out
}

/// Reverb, then the level brought to MUSIC_RMS (tanh rounds off a rare peak) and a fade at the end.
fn master(mix: &[f64]) -> Vec<f64> {
    let mut out = reverb(mix);
    let rms = (out.iter().map(|s| s * s).sum::<f64>() / out.len().max(1) as f64).sqrt();
    let gain = MUSIC_RMS / rms.max(1e-9);
    let fade_from = out.len().saturating_sub(sample_count(FADE_OUT_S));
    let fade_len = (out.len() - fade_from).max(1) as f64;
    for (i, sample) in out.iter_mut().enumerate() {
        let fade = 1.0 - (i.saturating_sub(fade_from)) as f64 / fade_len;
        *sample = (*sample * gain).tanh() * fade;
    }
    out
}

/// Plays the playlist in a loop while the soundtrack is on and the window is shown.
#[derive(Default)]
pub struct Music(Arc<Mutex<State>>);

struct State {
    is_on: bool,
    is_hidden: bool,
    is_playing: bool,
    /// Bumped on every start and stop: a playback thread from an older one stops its player.
    generation: u64,
    /// Gain on the mix as written, 0 to MAX_VOLUME.
    volume: f64,
}

impl Default for State {
    fn default() -> Self {
        Self { is_on: false, is_hidden: false, is_playing: false, generation: 0, volume: 1.0 }
    }
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    // The state is a few flags: still consistent if a holder panicked.
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Music {
    pub fn set_on(&self, is_on: bool) {
        self.update(|state| state.is_on = is_on);
    }

    /// Heard mid-song: the samples are scaled as they stream to the player.
    pub fn set_volume(&self, volume: f64) {
        lock(&self.0).volume = volume.clamp(0.0, MAX_VOLUME);
    }

    /// The window went to the tray (or came back): the music pauses with it.
    pub fn set_window_shown(&self, is_shown: bool) {
        self.update(|state| state.is_hidden = !is_shown);
    }

    fn update(&self, change: impl FnOnce(&mut State)) {
        let mut state = lock(&self.0);
        change(&mut state);
        let should_play = state.is_on && !state.is_hidden;
        if should_play == state.is_playing {
            return;
        }
        state.is_playing = should_play;
        state.generation += 1;
        if should_play {
            let (shared, generation) = (self.0.clone(), state.generation);
            thread::spawn(move || play_playlist(&shared, generation));
        }
    }
}

fn play_playlist(state: &Mutex<State>, generation: u64) {
    for compose in PLAYLIST.iter().cycle() {
        let track = compose();
        let path = match sound::rendered(&format!("music-{}", track.name), || render(&track)) {
            Ok(path) => path,
            Err(err) => {
                eprintln!("[music] {err}");
                return;
            }
        };
        if !play_through(state, generation, &path) {
            return;
        }
    }
}

/// The player reads raw 16-bit mono PCM on stdin, so the volume is applied here as it streams.
fn spawn_player(player: &str) -> std::io::Result<Child> {
    let rate = sound::RATE;
    let args = match player {
        "pw-play" => format!("--raw --rate={rate} --channels=1 --format=s16 -"),
        "paplay" => format!("--raw --rate={rate} --channels=1 --format=s16le"),
        _ => format!("-q -t raw -f S16_LE -r {rate} -c 1 -"), // aplay
    };
    let mut command = Command::new(player);
    command.args(args.split(' ')).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    // If the app dies without stopping the music, the kernel stops the player too.
    unsafe {
        command.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
    }
    let child = command.spawn()?;
    if let Some(stdin) = &child.stdin {
        // Best effort: with the default 64 KiB pipe a change lags ~0.75 s, still fine.
        unsafe { libc::fcntl(stdin.as_raw_fd(), libc::F_SETPIPE_SZ, PIPE_BYTES) };
    }
    Ok(child)
}

/// Writes the samples at the current volume; false when the music was stopped or the player quit.
fn feed(state: &Mutex<State>, generation: u64, samples: &[u8], out: &mut impl Write) -> bool {
    for chunk in samples.chunks(CHUNK_BYTES) {
        let volume = {
            let state = lock(state);
            if state.generation != generation {
                return false;
            }
            state.volume
        };
        // `as` saturates, so a loud sample turned up clips instead of wrapping around.
        let scaled: Vec<u8> = chunk.as_chunks::<2>().0.iter().flat_map(|&pair| ((i16::from_le_bytes(pair) as f64 * volume) as i16).to_le_bytes()).collect();
        if out.write_all(&scaled).is_err() {
            return false;
        }
    }
    true
}

/// Plays one file to the end; false when the music was stopped meanwhile or no player works.
fn play_through(state: &Mutex<State>, generation: u64, path: &Path) -> bool {
    let wav = match fs::read(path) {
        Ok(wav) => wav,
        Err(err) => {
            eprintln!("[music] failed to read {}: {err}", path.display());
            return false;
        }
    };
    let samples = wav.get(WAV_HEADER_BYTES..).unwrap_or_default();
    for player in sound::PLAYERS {
        let Ok(mut child) = spawn_player(player) else { continue };
        let is_fed = child.stdin.take().is_some_and(|mut stdin| feed(state, generation, samples, &mut stdin));
        // stdin is closed now: the player drains what it holds, then exits.
        loop {
            if lock(state).generation != generation {
                let _ = child.kill(); // fails only if it already exited
                let _ = child.wait();
                return false;
            }
            match child.try_wait() {
                Ok(Some(status)) if status.success() && is_fed => return true,
                Ok(Some(_)) | Err(_) => break, // this player can't play it: try the next one
                Ok(None) => thread::sleep(PLAYER_POLL),
            }
        }
    }
    eprintln!("[music] no player could play {}", path.display());
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_note_names_and_chord_symbols() {
        assert_eq!(midi("A4"), 69);
        assert_eq!(midi("C#5"), 73);
        assert_eq!(midi("Bb3"), 58);
        let d_over_f_sharp = chord("D/F#");
        assert_eq!(d_over_f_sharp.bass, midi("F#2"));
        assert_eq!(d_over_f_sharp.tones, vec![midi("A3"), midi("D4"), midi("F#4")]);
        assert_eq!(chord("Gm7").tones, vec![midi("G3"), midi("A#3"), midi("D4"), midi("F4")]);
        assert_eq!(chord("Eb").bass, midi("Eb2"));
        assert_eq!(chord("Csus2").tones, vec![midi("G3"), midi("C4"), midi("D4")]);
        assert_eq!(chord("Csus2").tone(3), midi("G4"));
    }

    // Composing checks that every bar of every tune is full and every bar has its chord.
    #[test]
    fn every_track_renders_loud_enough_long_enough_and_never_clips() {
        for compose in PLAYLIST {
            let track = compose();
            let samples = render(&track);
            let seconds = samples.len() as f64 / RATE;
            let peak = samples.iter().fold(0.0f64, |m, s| m.max(s.abs()));
            let rms = (samples.iter().map(|s| s * s).sum::<f64>() / samples.len() as f64).sqrt();
            assert!((60.0..100.0).contains(&seconds), "{}: {seconds}s", track.name);
            assert!(peak < 0.6, "{}: peak {peak}", track.name);
            assert!(rms > 0.03, "{}: rms {rms}", track.name);
            assert!(samples.last().is_some_and(|s| s.abs() < 1e-3), "{}: ends abruptly", track.name);
        }
    }

    #[test]
    fn streams_the_samples_at_the_current_volume() {
        let pcm = |samples: &[i16]| samples.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<u8>>();
        let state = Mutex::new(State::default());
        let mut out = Vec::new();
        lock(&state).volume = 0.5;
        assert!(feed(&state, 0, &pcm(&[1000, -2000]), &mut out));
        assert_eq!(out, pcm(&[500, -1000]));
        out.clear();
        lock(&state).volume = MAX_VOLUME;
        assert!(feed(&state, 0, &pcm(&[i16::MAX]), &mut out));
        assert_eq!(out, pcm(&[i16::MAX]), "turned up past full scale, a sample clips instead of wrapping");
        assert!(!feed(&state, 1, &pcm(&[1000]), &mut out), "a stopped song stops streaming");
    }

    /// A player process started by this one (the song streams on stdin, so no file in its cmdline).
    fn is_playing_music() -> bool {
        let me = std::process::id().to_string();
        let mut stats = std::fs::read_dir("/proc").into_iter().flatten().flatten().filter_map(|entry| std::fs::read_to_string(entry.path().join("stat")).ok());
        stats.any(|stat| {
            let Some((head, tail)) = stat.rsplit_once(") ") else { return false };
            let name = head.split_once(" (").map_or("", |(_, name)| name);
            sound::PLAYERS.contains(&name) && tail.split(' ').nth(1) == Some(me.as_str())
        })
    }

    #[test]
    #[ignore = "plays music on this machine; run with --ignored"]
    fn starts_and_pauses_with_the_window() {
        let music = Music::default();
        music.set_on(true);
        thread::sleep(Duration::from_secs(3));
        assert!(is_playing_music(), "the first song should be playing");
        music.set_window_shown(false);
        thread::sleep(PLAYER_POLL * 5);
        assert!(!is_playing_music(), "hiding the window should stop the player");
    }
}
