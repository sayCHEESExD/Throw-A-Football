/**
 * Keyboard, mouse and touch, reduced to what the game asks for.
 *
 * Desktop, SHIFT-LOCK ON (the default): click the game to lock the mouse;
 * moving it turns the camera and the centre reticle is where you throw. The
 * click that captures the mouse is never a throw. Left click then hikes /
 * throws (once to start the power meter, again to release). Ctrl, C or Esc
 * frees the mouse for a moment; the next click on the game captures it again.
 *
 * SHIFT-LOCK OFF (Q or the lock button): the mouse stays free, left click
 * throws and right-drag turns the camera. If the browser keeps refusing the
 * lock (an embed without pointer-lock permission), the game switches to this
 * itself and says so. WASD moves, Shift sprints, Space jumps, the wheel zooms.
 *
 * Touch: a floating joystick on the left half; dragging on the right half
 * turns the camera; on-screen buttons drive throw / hike / jump / sprint.
 */
const SHIFT_LOCK_KEY = 'tf.shiftlock';
/** Browsers refuse a new pointer lock for about this long after one ends. */
const LOCK_COOLDOWN_MS = 1500;

export class Input {
  readonly touch: boolean;
  /** -1..1 in screen space: x right, y forward. */
  moveX = 0;
  moveY = 0;
  sprint = false;
  /** Pointer in normalised device coordinates. */
  readonly pointer = { x: 0, y: -0.2, active: false };
  /** False while a menu is open: the mouse stays free. */
  private lockAllowed = true;
  /** Shift-lock: the mouse is captured to turn the camera (Q toggles it). */
  private shiftLockOn = true;
  /** When the lock last ended (browsers refuse a new one for about a second after). */
  private unlockedAt = 0;
  /** Lock requests refused in a row, outside that cooldown. */
  private lockFailures = 0;
  /** A lock request is waiting for an answer (its refusal is counted once). */
  private lockPending = false;
  /** Camera turn accumulated since the last read (radians). */
  yawDelta = 0;
  pitchDelta = 0;
  zoomDelta = 0;
  /** Lets touch drags on the right half also turn the camera. */
  touchTurns = true;

  private readonly keys = new Set<string>();
  private primaryQueued = 0;
  private jumpQueued = false;
  private readonly listeners: Array<(key: string) => void> = [];

  // Touch joystick.
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private aimId = -1;
  private aimStartX = 0;
  private aimStartY = 0;
  private aimMoved = false;
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private sensitivity = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // A touch device is one whose main pointer is a finger (a touchscreen laptop still has a mouse).
    this.touch = matchMedia('(pointer: coarse)').matches || (!matchMedia('(any-pointer: fine)').matches && 'ontouchstart' in window);
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'stick-knob';
    this.stickBase.appendChild(this.stickKnob);
    document.body.appendChild(this.stickBase);

    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.moveEvt(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    try {
      this.shiftLockOn = localStorage.getItem(SHIFT_LOCK_KEY) !== 'off';
    } catch {
      /* storage blocked: keep the default */
    }
    if (typeof canvas.requestPointerLock !== 'function') this.shiftLockOn = false;
    document.addEventListener('pointerlockchange', () => {
      this.lockPending = false;
      if (this.locked) {
        this.lockFailures = 0;
      } else {
        this.dragging = false;
        this.unlockedAt = performance.now();
      }
      // Never carry a click across a lock change: capturing (or losing) the
      // mouse must not start or release a throw.
      this.primaryQueued = 0;
      for (const l of this.lockListeners) l(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.lockRefused());
    canvas.addEventListener('wheel', (e) => {
      this.zoomDelta += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private readonly lockListeners: Array<(locked: boolean) => void> = [];

  /** The mouse is captured (shift-lock): it turns the camera. */
  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  onLockChange(listener: (locked: boolean) => void): void {
    this.lockListeners.push(listener);
  }

  /** Called every frame with !panelOpen: a menu frees the mouse and blocks relocking. */
  setLockAllowed(allowed: boolean): void {
    this.lockAllowed = allowed;
    if (!allowed && this.locked) document.exitPointerLock();
  }

  /** Free the mouse for now (Ctrl / C); the next click on the game captures it again. */
  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Shift-lock on: clicks capture the mouse. Off: the mouse stays free and clicks throw. */
  get shiftLock(): boolean {
    return this.shiftLockOn && !this.touch;
  }

  onShiftLockChange(listener: (on: boolean, reason: 'toggle' | 'refused') => void): void {
    this.shiftLockListeners.push(listener);
  }

  private readonly shiftLockListeners: Array<(on: boolean, reason: 'toggle' | 'refused') => void> = [];

  /** Q or the lock button. Turning it on captures the mouse straight away. */
  toggleShiftLock(): void {
    this.setShiftLock(!this.shiftLockOn, 'toggle');
    if (this.shiftLockOn) this.requestLock();
  }

  private setShiftLock(on: boolean, reason: 'toggle' | 'refused'): void {
    if (this.touch || on === this.shiftLockOn) return;
    this.shiftLockOn = on;
    this.lockFailures = 0;
    this.primaryQueued = 0;
    if (!on && this.locked) document.exitPointerLock();
    try {
      localStorage.setItem(SHIFT_LOCK_KEY, on ? 'on' : 'off');
    } catch {
      /* storage blocked: it lasts for this visit */
    }
    for (const l of this.shiftLockListeners) l(on, reason);
  }

  private requestLock(): void {
    if (this.touch || !this.shiftLockOn || !this.lockAllowed || this.locked) return;
    this.lockPending = true;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => this.lockRefused());
    } catch {
      this.lockRefused();
    }
  }

  /**
   * The browser said no. Right after a lock ends it always does (about a
   * second), so that just means "click again". Refused three times in a row
   * outside that window, pointer lock is not available here: shift-lock turns
   * itself off so clicks throw and right-drag turns (Q turns it back on).
   */
  private lockRefused(): void {
    // Browsers report one refusal twice (the event and the promise).
    if (!this.lockPending) return;
    this.lockPending = false;
    if (performance.now() - this.unlockedAt < LOCK_COOLDOWN_MS) return;
    this.lockFailures += 1;
    if (this.lockFailures >= 3) this.setShiftLock(false, 'refused');
  }

  setSensitivity(scale: number): void {
    this.sensitivity = Math.max(0.2, Math.min(4, scale));
  }

  onKey(listener: (key: string) => void): void {
    this.listeners.push(listener);
  }

  /** A click/tap on the field (or the throw button) since the last call. */
  takePrimary(): boolean {
    if (this.primaryQueued <= 0) return false;
    this.primaryQueued -= 1;
    return true;
  }

  clearPrimary(): void {
    this.primaryQueued = 0;
  }

  pressPrimary(): void {
    this.primaryQueued = Math.min(2, this.primaryQueued + 1);
  }

  takeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  pressJump(): void {
    this.jumpQueued = true;
  }

  takeTurn(): { yaw: number; pitch: number; zoom: number } {
    const out = { yaw: this.yawDelta, pitch: this.pitchDelta, zoom: this.zoomDelta };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.zoomDelta = 0;
    return out;
  }

  /** Recompute the move vector from keys and the stick. */
  poll(): void {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.stickId >= 0) {
      x = this.stickX;
      y = this.stickY;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.moveX = x;
    this.moveY = y;
    if (!this.touch) this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (!e.repeat) {
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') this.unlock();
      if (e.code === 'KeyQ' && !this.touch && this.lockAllowed) this.toggleShiftLock();
      for (const l of this.listeners) l(e.code);
    }
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  private setPointer(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.pointer.active = true;
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      const left = e.clientX < window.innerWidth * 0.42;
      if (left && this.stickId < 0) {
        this.stickId = e.pointerId;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.stickBase.style.left = `${e.clientX}px`;
        this.stickBase.style.top = `${e.clientY}px`;
        this.stickBase.classList.add('on');
        this.stickKnob.style.transform = 'translate(-50%, -50%)';
      } else if (this.aimId < 0) {
        this.aimId = e.pointerId;
        this.aimStartX = this.lastX = e.clientX;
        this.aimStartY = this.lastY = e.clientY;
        this.aimMoved = false;
        this.setPointer(e);
      }
      return;
    }
    if (e.button === 2) {
      if (!this.locked) {
        e.preventDefault();
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    } else if (e.button === 0) {
      // A canvas click while a menu is open does nothing.
      if (!this.lockAllowed) return;
      if (this.locked || !this.shiftLockOn) {
        this.pressPrimary();
      } else {
        // Shift-lock on and the mouse is free: this click only captures it.
        // It is never a throw, however many times it takes.
        this.requestLock();
      }
    }
  }

  private moveEvt(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.stickId) {
        const bx = parseFloat(this.stickBase.style.left);
        const by = parseFloat(this.stickBase.style.top);
        let dx = e.clientX - bx;
        let dy = e.clientY - by;
        const max = 55;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        this.stickX = dx / max;
        this.stickY = -dy / max;
        this.sprint = len > max * 0.95;
        this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.aimId) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        if (Math.hypot(e.clientX - this.aimStartX, e.clientY - this.aimStartY) > 10) this.aimMoved = true;
        if (this.touchTurns) {
          this.yawDelta -= dx * 0.006 * this.sensitivity;
          this.pitchDelta += dy * 0.004 * this.sensitivity;
        }
      }
      return;
    }
    if (this.locked) {
      this.yawDelta -= e.movementX * 0.0032 * this.sensitivity;
      this.pitchDelta += e.movementY * 0.0026 * this.sensitivity;
      return;
    }
    if (this.dragging) {
      this.yawDelta -= (e.clientX - this.lastX) * 0.005 * this.sensitivity;
      this.pitchDelta += (e.clientY - this.lastY) * 0.004 * this.sensitivity;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.stickId) {
        this.stickId = -1;
        this.stickX = 0;
        this.stickY = 0;
        this.sprint = false;
        this.stickBase.classList.remove('on');
      } else if (e.pointerId === this.aimId) {
        this.aimId = -1;
      }
      return;
    }
    if (e.button === 2) this.dragging = false;
  }
}
