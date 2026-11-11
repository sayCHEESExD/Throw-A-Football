import { boxityEnvironment } from '../bloxity/environment.js';
import { isBloxityEmoteId } from '@mctf/shared';
import { Euler, Quaternion } from 'three';
import { logger } from '../util/logger.js';
import type { BoneOverlay } from './rig/PlayerRig.js';

const SCOPE = 'emotes';

/**
 * Bloxity's emote catalogue. Fetched ONCE at startup and never hard-coded:
 * the catalogue grows without a game release, so this game knows no emote ids
 * and assumes nothing about how many there are.
 */
/** {apiUrl}/v1/avatar/emotes, from the told environment. */
const catalogueUrl = (): string => `${boxityEnvironment().apiUrl}/v1/avatar/emotes`;

/** Seconds to blend into (and out of, and between) emotes rather than snapping to the pose. */
export const EMOTE_BLEND = 0.1;

/**
 * Two sightings of the same emote id whose start times differ by less than
 * this are the SAME playing of it. That is how the owner's optimistic start
 * and the server's echo of it (a round trip later, stamped by the room clock)
 * are recognised as one emote rather than restarted, and how an emote that was
 * stopped by moving stays stopped until the server's clear arrives.
 */
const SAME_PLAYING = 0.3;

const DEG = Math.PI / 180;

/** `[timeSeconds, xDegrees, yDegrees, zDegrees]`. */
type Key = readonly [number, number, number, number];

interface Track {
  /** The bone NAME, as the catalogue spells it (`ArmR_Offset`, `Spine1`...). */
  readonly bone: string;
  /** Sorted by time; never empty. */
  readonly keys: readonly Key[];
}

export interface BloxityEmote {
  readonly id: string;
  readonly name: string;
  readonly len: number;
  readonly loop: boolean;
  readonly tracks: readonly Track[];
}

const catalogue = new Map<string, BloxityEmote>();

/** The room clock (server ms) a replicated start time is measured against. */
let roomClock: () => number = () => Date.now();
export const setEmoteClock = (clock: () => number): void => {
  roomClock = clock;
};
/** Seconds since a replicated start (server ms). */
export const emoteSecondsSince = (startMs: number): number => Math.max(0, (roomClock() - startMs) / 1000);
let loading: Promise<void> | null = null;

/**
 * One catalogue entry, validated. Anything malformed is dropped rather than
 * trusted: the clip is data from another service, and a NaN in a key would be
 * a NaN in a bone and an invisible player.
 */
const parseEmote = (raw: unknown): BloxityEmote | null => {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as { id?: unknown; name?: unknown; clip?: unknown };
  if (!isBloxityEmoteId(entry.id) || !entry.clip || typeof entry.clip !== 'object') return null;
  const clip = entry.clip as { len?: unknown; loop?: unknown; tracks?: unknown };
  const len = Number(clip.len);
  if (!Number.isFinite(len) || len <= 0) return null;
  const tracks: Track[] = [];
  if (clip.tracks && typeof clip.tracks === 'object') {
    for (const [bone, keysRaw] of Object.entries(clip.tracks as Record<string, unknown>)) {
      if (!Array.isArray(keysRaw)) continue;
      const keys: Key[] = [];
      for (const key of keysRaw) {
        if (!Array.isArray(key) || key.length < 4) continue;
        const [t, x, y, z] = [Number(key[0]), Number(key[1]), Number(key[2]), Number(key[3])];
        if ([t, x, y, z].every(Number.isFinite)) keys.push([t, x, y, z]);
      }
      if (keys.length === 0) continue;
      keys.sort((a, b) => a[0] - b[0]);
      tracks.push({ bone, keys });
    }
  }
  return {
    id: entry.id.toLowerCase(),
    name: typeof entry.name === 'string' ? entry.name : entry.id,
    len,
    loop: clip.loop !== false,
    tracks,
  };
};

/**
 * Fetch the catalogue - once, at boot, alongside the SDK rather than after the
 * assets, so it is there by the time anybody can press the portal's emote
 * button. Never rejects: a catalogue that failed to load leaves every emote id
 * "unknown", which is ignored silently everywhere.
 */
export const loadBloxityEmotes = (): Promise<void> => {
  loading ??= (async () => {
    try {
      const response = await fetch(catalogueUrl());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { emotes?: unknown };
      const list = Array.isArray(body?.emotes) ? body.emotes : [];
      for (const raw of list) {
        const emote = parseEmote(raw);
        if (emote) catalogue.set(emote.id, emote);
      }
      logger.info(SCOPE, `${catalogue.size} Bloxity emotes loaded`);
    } catch (error) {
      logger.warn(SCOPE, `emote catalogue unavailable - emotes will not play: ${String(error)}`);
    }
  })();
  return loading;
};

/** The clip for a catalogue id, or undefined for an unknown one (or before / without a catalogue). */
export const bloxityEmote = (id: string): BloxityEmote | undefined =>
  id ? catalogue.get(id.toLowerCase()) : undefined;

/** One track's degrees at time t: clamped outside the keys, smoothstep between them. */
const sampleTrack = (keys: readonly Key[], t: number, out: [number, number, number]): void => {
  const first = keys[0] as Key;
  const last = keys[keys.length - 1] as Key;
  if (t <= first[0]) {
    out[0] = first[1];
    out[1] = first[2];
    out[2] = first[3];
    return;
  }
  if (t >= last[0]) {
    out[0] = last[1];
    out[1] = last[2];
    out[2] = last[3];
    return;
  }
  let i = 0;
  while (i < keys.length - 2 && (keys[i + 1] as Key)[0] <= t) i += 1;
  const a = keys[i] as Key;
  const b = keys[i + 1] as Key;
  let s = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  s = s * s * (3 - 2 * s);
  out[0] = a[1] + (b[1] - a[1]) * s;
  out[1] = a[2] + (b[2] - a[2]) * s;
  out[2] = a[3] + (b[3] - a[3]) * s;
};

const DEGREES: [number, number, number] = [0, 0, 0];
const EULER = new Euler();
const IDENTITY = new Quaternion();
const TO = new Quaternion();
const smooth = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * ONE BODY'S BLOXITY EMOTE: which one, how far in, and how strongly it holds
 * the body - the `BoneOverlay` `PlayerRig` lays over the procedural pose.
 *
 * The clips are authored for Bloxity's own `player.glb`, which is exactly the
 * rig a signed-in citizen wears, so they are applied as Bloxity specifies: per bone a
 * LOCAL delta, degrees -> radians, euler order XYZ, right-multiplied onto the
 * bone's bind quaternion (the rig does the multiply, bone by bone, by NAME -
 * which is also what makes a bone the rig lacks drop out on its own).
 *
 * It is driven by (id, seconds in) every frame, from the replicated state
 * (and, for the owner, an optimistic start until the server echoes it), and
 * decides for itself when a playing starts, restarts, crossfades or stops -
 * so the same code gives the same answer on every screen.
 *
 * Here an emote plays on a STANDING citizen only - sitting, driving, being
 * cuffed or walking off stops it - so it takes the whole body (`skip` is empty).
 */
export class BloxityEmotePlayer implements BoneOverlay {
  /** 0..1, eased: how much of the body the emote holds this frame. */
  weight = 0;
  /** Bones the emote leaves to the procedural pose (none: it only ever plays on a standing citizen). */
  skip: ReadonlySet<string> = new Set();
  /** The sampled clip: a local rotation delta per bone name, rebuilt each frame. */
  readonly deltas = new Map<string, Quaternion>();

  private emote: BloxityEmote | null = null;
  /** The playing's start, in the animator's clock (identity only: the time comes from the input). */
  private start = 0;
  private time = 0;
  private stopping = false;
  /** Linear 0..1 behind `weight`. */
  private ramp = 0;
  /** A playing that was stopped: never resumed, however long its replicated state lingers. */
  private droppedId = '';
  private droppedStart = 0;
  /** Crossfade from the previous clip's last pose, when one emote replaces another. */
  private readonly from = new Map<string, Quaternion>();
  private fade = 1;
  private readonly pool: Quaternion[] = [];

  /** True while any of the emote shows (including blending out). */
  get active(): boolean {
    return this.emote !== null && this.weight > 0.001;
  }

  /** True while the emote holds (or is taking) the body - not blending out. */
  get playing(): boolean {
    return this.emote !== null && !this.stopping;
  }

  /** The catalogue id playing ('' none), for tests. */
  get currentId(): string {
    return this.emote && !this.stopping ? this.emote.id : '';
  }

  /**
   * Advance one frame.
   *
   * @param clock the animator's clock (seconds)
   * @param id    the emote this body should play ('' none)
   * @param time  seconds since it began (room clock - replicated start)
   * @param free  the body is free: standing still, not seated, driving or
   *              cuffed. A playing that meets a busy body
   *              stops for good, and one that arrives on them never starts.
   */
  update(dt: number, clock: number, id: string, time: number, free: boolean): void {
    const want = id ? bloxityEmote(id) : undefined;
    const since = Math.max(0, Number.isFinite(time) ? time : 0);
    const start = clock - since;
    const current = this.emote;
    const isCurrent = !!want && !!current && !this.stopping && want.id === current.id && Math.abs(start - this.start) < SAME_PLAYING;
    const isDropped = !!want && want.id === this.droppedId && Math.abs(start - this.droppedStart) < SAME_PLAYING;

    if (isCurrent) {
      if (!free) {
        this.stop();
      } else {
        // Follow the replicated clock, so every screen shows the same frame.
        this.start = start;
        this.time = since;
      }
    } else if (want && !isDropped) {
      if (free) this.begin(want, start, since);
      else {
        // Arrived on a busy body: it never plays.
        this.droppedId = want.id;
        this.droppedStart = start;
        if (current && !this.stopping) this.stop();
      }
    } else if (current && !this.stopping) {
      // Cleared (by the server, or locally by the first press), or unknown: blend out.
      this.stop();
    }

    if (this.stopping) this.time += dt;

    const rate = dt / EMOTE_BLEND;
    this.ramp = this.stopping ? Math.max(0, this.ramp - rate) : Math.min(1, this.ramp + rate);
    this.fade = Math.min(1, this.fade + rate);
    this.weight = this.emote ? smooth(this.ramp) : 0;
    if (this.stopping && this.ramp <= 0) {
      this.emote = null;
      this.stopping = false;
      this.weight = 0;
      this.releaseDeltas();
      return;
    }
    if (this.emote) this.sample(this.emote);
  }

  /** Stop at once (the body was reset or re-dressed): blend out from wherever it is. */
  stop(): void {
    if (!this.emote || this.stopping) return;
    this.stopping = true;
    this.droppedId = this.emote.id;
    this.droppedStart = this.start;
  }

  /** Drop everything, immediately (a hard reset of the body). */
  clear(): void {
    this.emote = null;
    this.stopping = false;
    this.ramp = 0;
    this.weight = 0;
    this.releaseDeltas();
  }

  private begin(emote: BloxityEmote, start: number, since: number): void {
    if (this.emote && this.weight > 0.001) {
      // One emote replacing another: crossfade from the pose the old one reached.
      this.releaseFrom();
      for (const [bone, q] of this.deltas) this.from.set(bone, this.take().copy(q));
      this.fade = 0;
    } else {
      this.releaseFrom();
      this.fade = 1;
    }
    this.emote = emote;
    this.start = start;
    this.time = since;
    this.stopping = false;
  }

  /** Write every track's delta at the current time into `deltas`. */
  private sample(emote: BloxityEmote): void {
    const t = emote.loop ? ((this.time % emote.len) + emote.len) % emote.len : this.time;
    this.releaseDeltas();
    for (const track of emote.tracks) {
      sampleTrack(track.keys, t, DEGREES);
      EULER.set(DEGREES[0] * DEG, DEGREES[1] * DEG, DEGREES[2] * DEG, 'XYZ');
      const q = this.take().setFromEuler(EULER);
      this.deltas.set(track.bone, q);
    }
    if (this.fade < 1) {
      const s = smooth(this.fade);
      for (const [bone, q] of this.deltas) {
        TO.copy(q);
        q.copy(this.from.get(bone) ?? IDENTITY).slerp(TO, s);
      }
      // A bone only the OLD clip moved eases back to its bind pose.
      for (const [bone, q] of this.from) {
        if (!this.deltas.has(bone)) this.deltas.set(bone, this.take().copy(q).slerp(IDENTITY, s));
      }
    } else if (this.from.size > 0) {
      this.releaseFrom();
    }
  }

  private take(): Quaternion {
    return this.pool.pop() ?? new Quaternion();
  }

  private releaseDeltas(): void {
    for (const q of this.deltas.values()) this.pool.push(q.identity());
    this.deltas.clear();
  }

  private releaseFrom(): void {
    for (const q of this.from.values()) this.pool.push(q.identity());
    this.from.clear();
  }
}
