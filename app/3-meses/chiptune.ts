"use client";

import { ensureSharedAudioContextRunning, getSharedAudioContext } from "@/lib/audioContext";

// The "3 meses" page's background music: a small, original 8-bit loop played
// live through Web Audio — no file, no licence. Square lead, triangle bass,
// an arpeggio and noise drums, scheduled slightly ahead of time (the usual
// "lookahead" scheduler) so the timer's jitter never reaches the beat.
//
// The mood follows the scene on screen: calm for the story, a minor glitchy
// variation for the outage and the bug wall, a slow lullaby for the 3 a.m.
// commits and the full band for the finale. A new mood starts at the next bar.

export type MusicMood = "calm" | "tense" | "night" | "party";

type Step = number | null;
interface Song {
  bpm: number;
  chords: number[][]; // one triad per bar (MIDI)
  lead: Step[]; // 8 eighth notes per bar
  leadType: OscillatorType;
  leadGain: number;
  arpGain: number;
  bassGain: number;
  drums: "none" | "soft" | "full";
  glitch: boolean;
}

const MAJOR = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
];
const MINOR = [
  [57, 60, 64],
  [53, 57, 60],
  [50, 53, 57],
  [52, 56, 59],
];
const _ = null;
const MAJOR_LEAD: Step[] = [
  72, _, 76, 79, 76, _, 74, 72,
  69, _, 72, 76, 74, 72, 69, _,
  65, 69, 72, _, 77, 76, 74, 72,
  74, _, 71, 67, 71, 74, 79, _,
];
const MINOR_LEAD: Step[] = [
  69, 72, 76, 72, 69, _, 64, _,
  65, 69, 72, 69, 65, _, 60, _,
  62, 65, 69, 65, 62, _, 57, _,
  64, 68, 71, 68, 64, _, 59, _,
];
const NIGHT_LEAD: Step[] = [
  79, _, _, _, 76, _, _, _,
  76, _, _, _, 72, _, _, _,
  77, _, _, _, 72, _, _, _,
  74, _, _, _, 71, _, _, _,
];

const SONGS: Record<MusicMood, Song> = {
  calm: { bpm: 112, chords: MAJOR, lead: MAJOR_LEAD, leadType: "square", leadGain: 0.05, arpGain: 0.035, bassGain: 0.12, drums: "soft", glitch: false },
  tense: { bpm: 124, chords: MINOR, lead: MINOR_LEAD, leadType: "sawtooth", leadGain: 0.035, arpGain: 0.03, bassGain: 0.13, drums: "full", glitch: true },
  night: { bpm: 80, chords: MAJOR, lead: NIGHT_LEAD, leadType: "triangle", leadGain: 0.07, arpGain: 0.025, bassGain: 0.08, drums: "none", glitch: false },
  party: { bpm: 132, chords: MAJOR, lead: MAJOR_LEAD, leadType: "square", leadGain: 0.06, arpGain: 0.04, bassGain: 0.14, drums: "full", glitch: false },
};

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const STEPS_PER_BAR = 8;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Chiptune {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextAt = 0;
  private mood: MusicMood = "calm";
  private pendingMood: MusicMood | null = null;
  playing = false;

  setMood(mood: MusicMood) {
    if (mood === this.mood && this.pendingMood === null) return;
    this.pendingMood = mood;
  }

  /** One start at a time: the first click can arrive both as "a gesture" and as the button's own click. */
  start(): Promise<boolean> {
    if (this.playing) return Promise.resolve(true);
    this.starting ??= this.begin().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private starting: Promise<boolean> | null = null;

  private async begin(): Promise<boolean> {
    const ctx = getSharedAudioContext();
    if (!ctx) return false;
    await ensureSharedAudioContextRunning();
    this.ctx = ctx;
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    if (!this.noise) {
      const length = Math.floor(ctx.sampleRate * 0.25);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0.0001, now);
    this.master.gain.exponentialRampToValueAtTime(0.9, now + 0.6);
    this.step = 0;
    this.nextAt = now + 0.08;
    this.playing = true;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    return true;
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    const master = this.master;
    if (ctx && master) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    }
  }

  /** A short "bip" for the mascot, on the same graph (plays even with the music off). */
  async blip(pitch = 84) {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    await ensureSharedAudioContextRunning();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq(pitch), t);
    osc.frequency.exponentialRampToValueAtTime(freq(pitch + 12), t + 0.08);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    while (this.nextAt < ctx.currentTime + LOOKAHEAD_S) {
      if (this.step % STEPS_PER_BAR === 0 && this.pendingMood) {
        this.mood = this.pendingMood;
        this.pendingMood = null;
      }
      const song = SONGS[this.mood];
      const stepDur = 60 / song.bpm / 2;
      this.playStep(song, this.step, this.nextAt, stepDur);
      this.nextAt += stepDur;
      this.step = (this.step + 1) % (STEPS_PER_BAR * song.chords.length);
    }
  }

  private playStep(song: Song, step: number, t: number, dur: number) {
    const bar = Math.floor(step / STEPS_PER_BAR) % song.chords.length;
    const inBar = step % STEPS_PER_BAR;
    const chord = song.chords[bar];

    // Bass: root on the beat, an octave jump on the off-beat.
    if (inBar % 2 === 0) {
      this.tone("triangle", freq(chord[0] - 24 + (inBar % 4 === 2 ? 12 : 0)), t, dur * 0.9, song.bassGain);
    }
    // Arpeggio: up the triad, two notes per eighth.
    const arp = [chord[0], chord[1], chord[2], chord[1] + 12];
    this.tone("square", freq(arp[(inBar * 2) % 4] + 12), t, dur * 0.45, song.arpGain);
    this.tone("square", freq(arp[(inBar * 2 + 1) % 4] + 12), t + dur / 2, dur * 0.45, song.arpGain);

    const note = song.lead[step % song.lead.length];
    if (note !== null) {
      const glitchy = song.glitch && Math.random() < 0.18;
      this.tone(song.leadType, freq(note + (glitchy ? (Math.random() < 0.5 ? -1 : 13) : 0)), t, dur * 0.85, song.leadGain, glitchy);
    }

    if (song.drums !== "none") {
      if (inBar === 0 || inBar === 4) this.kick(t, song.drums === "full" ? 0.5 : 0.3);
      if (inBar === 2 || inBar === 6) this.hit(t, 0.12, 1800, song.drums === "full" ? 0.13 : 0.07);
      if (song.drums === "full") this.hit(t + dur / 2, 0.03, 7000, 0.04);
    }
  }

  private tone(type: OscillatorType, hz: number, t: number, dur: number, peak: number, wobble = false) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, t);
    if (wobble) osc.frequency.linearRampToValueAtTime(hz * 0.94, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private kick(t: number, peak: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  private hit(t: number, dur: number, highpass: number, peak: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpass;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
