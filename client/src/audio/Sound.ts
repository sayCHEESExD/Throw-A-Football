import musicUrl from '../../../assets/audio/music.mp3';
import cheerUrl from '../../../assets/audio/crowd_cheer.mp3';
import walkUrl from '../../../assets/audio/walk.mp3';
import jumpUrl from '../../../assets/audio/jump.mp3';
import throwUrl from '../../../assets/audio/throw-ball.mp3';

type Clip = 'cheer' | 'walk' | 'jump' | 'throw';

/**
 * Music, the bundled clips (the throw and catch use the recorded
 * throw-ball clip), and small synthesized effects (whistle, hike, tackle,
 * ring, cash) so they cost no download.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfx: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private walkSource: AudioBufferSourceNode | null = null;
  private walkGain: GainNode | null = null;
  private masterLevel = 0.8;
  private musicLevel = 0.5;
  private muted = false;
  private paused = false;
  private wantMusic = false;

  constructor() {
    const unlock = (): void => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): void {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.applyLevels();
    for (const [key, url] of [['music', musicUrl], ['cheer', cheerUrl], ['walk', walkUrl], ['jump', jumpUrl], ['throw', throwUrl]] as const) {
      void fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => {
          this.buffers.set(key, buf);
          if (key === 'music' && this.wantMusic) this.startMusic();
          if (key === 'walk') this.startWalk();
        })
        .catch(() => undefined);
    }
  }

  private applyLevels(): void {
    if (!this.master || !this.musicGain || !this.ctx) return;
    const on = !this.muted && !this.paused;
    this.master.gain.setTargetAtTime(on ? this.masterLevel : 0, this.ctx.currentTime, 0.05);
    this.musicGain.gain.setTargetAtTime(this.musicLevel * 0.35, this.ctx.currentTime, 0.2);
  }

  setMaster(level: number): void {
    this.masterLevel = level;
    this.applyLevels();
  }

  setMusic(level: number): void {
    this.musicLevel = level;
    this.applyLevels();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyLevels();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyLevels();
    return !this.muted;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyLevels();
  }

  music(on: boolean): void {
    this.wantMusic = on;
    if (on) this.startMusic();
    else if (this.musicSource) {
      this.musicSource.stop();
      this.musicSource = null;
    }
  }

  private startMusic(): void {
    const buf = this.buffers.get('music');
    if (!this.ctx || !buf || this.musicSource || !this.musicGain) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(this.musicGain);
    s.start();
    this.musicSource = s;
  }

  private startWalk(): void {
    const buf = this.buffers.get('walk');
    if (!this.ctx || !buf || !this.sfx || this.walkSource) return;
    this.walkGain = this.ctx.createGain();
    this.walkGain.gain.value = 0;
    this.walkGain.connect(this.sfx);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(this.walkGain);
    s.start();
    this.walkSource = s;
  }

  /** Footsteps follow how fast the local player runs (0 = silent). */
  steps(speed: number): void {
    if (!this.walkGain || !this.walkSource || !this.ctx) return;
    this.walkGain.gain.setTargetAtTime(speed > 1 ? 0.5 : 0, this.ctx.currentTime, 0.05);
    this.walkSource.playbackRate.value = 0.9 + Math.min(1, speed / 18) * 0.5;
  }

  play(clip: Clip, volume = 1): void {
    const buf = this.buffers.get(clip);
    if (!this.ctx || !buf || !this.sfx) return;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    g.connect(this.sfx);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(g);
    s.start();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
    if (!this.ctx || !this.sfx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1): void {
    if (!this.ctx || !this.sfx) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
  }

  whistle(): void {
    this.tone(2350, 0.32, 'sine', 0.18);
    this.tone(2420, 0.32, 'sine', 0.1);
  }

  hike(): void {
    this.noise(0.12, 0.6, 700, 2);
  }

  throwBall(): void {
    this.play('throw', 1);
  }

  catchBall(): void {
    this.play('throw', 0.8);
  }

  tackle(): void {
    this.noise(0.22, 1.1, 180, 0.7);
  }

  ring(streak: number): void {
    const base = 660 * Math.pow(1.06, Math.min(streak, 12));
    this.tone(base, 0.18, 'triangle', 0.22);
    this.tone(base * 1.5, 0.22, 'triangle', 0.16, 0, 0.07);
  }

  cash(): void {
    this.tone(1320, 0.08, 'square', 0.06);
    this.tone(1760, 0.14, 'square', 0.06, 0, 0.06);
  }

  miss(): void {
    this.tone(300, 0.3, 'sawtooth', 0.08, -150);
  }
}

export const sound = new Sound();
