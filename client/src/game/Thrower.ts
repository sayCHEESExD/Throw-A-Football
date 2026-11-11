import { Raycaster, Vector2, Vector3, type Camera, type Scene } from 'three';
import type { ArmStats } from '@mctf/shared';
import { BALL_GRAVITY } from '../world/Ball.js';

/** Height a receiver catches the ball at. */
export const CATCH_HEIGHT = 1.9;
const METER_PERIOD = 1.25;
const ray = new Raycaster();
const CENTER = new Vector2(0, 0);
const hit = new Vector3();
/** The field surface the reticle lands on (a hair above the grass). */
const GROUND_Y = 0.2;
/** How far along the reticle ray a sky aim points. */
const FAR = 400;
const UP = new Vector3(0, 1, 0);
const tmp = new Vector3();

export interface ThrowEvent {
  from: Vector3;
  velocity: Vector3;
  time: number;
  landing: Vector3;
  perfect: boolean;
  power: number;
}

/** Something the centre reticle can lock onto (a practice ring). */
export interface AimTarget {
  center: Vector3;
  radius: number;
}

/**
 * The two-click throw, aimed with the centre-of-screen reticle: the ball
 * always goes toward whatever the reticle is on. Click once to start the
 * power meter, click again to let it go. Releasing inside the meter's
 * highlighted band (the power that reaches the reticle) is a PERFECT throw:
 * right on the spot, with no spread.
 */
export class Thrower {
  /** Where the reticle points (3D: a ring's centre, or catch height over the field). */
  readonly aim = new Vector3(0, CATCH_HEIGHT, 10);
  charging = false;
  power = 0;
  private chargeTime = 0;

  constructor(_scene: Scene) {}

  /** Kept for callers; the reticle is the 2D HUD circle now. */
  set visible(_v: boolean) {}

  /** Unit launch direction: from the hand along the reticle's 3D line. */
  readonly dir = new Vector3(0, 0, 1);

  /**
   * Cast the ray through the centre of the screen and find what it is on:
   * a ring, a player's body, the field (your feet included), or nothing
   * (the sky). The ball's launch direction is the exact 3D line from the
   * hand to that point, so looking up throws up and looking down throws
   * down. Nothing is ever flattened.
   */
  aimFromCenter(camera: Camera, from: Vector3, _stats: ArmStats, targets: readonly AimTarget[] = []): void {
    ray.setFromCamera(CENTER, camera);
    const r = ray.ray;
    let best = Infinity;
    for (const t of targets) {
      const d = r.distanceSqToPoint(t.center);
      if (d > t.radius * t.radius) continue;
      const along = tmp.subVectors(t.center, r.origin).dot(r.direction);
      if (along > 0 && along < best) {
        best = along;
        this.aim.copy(t.center);
      }
    }
    if (best === Infinity) {
      if (r.direction.y < -1e-4) r.at((GROUND_Y - r.origin.y) / r.direction.y, this.aim);
      // Sky: a far point on the ray, so the direction is the camera's own.
      else r.at(FAR, this.aim);
    }
    this.dir.subVectors(this.aim, from);
    // Too close to the hand to give a direction (aiming at your own feet from above): use the ray.
    if (this.dir.lengthSq() < 0.25) this.dir.copy(r.direction);
    this.dir.normalize();
  }

  /**
   * Where the PERFECT band sits on the meter: at the top. Power is throw
   * speed, so a full-strength release is the one that reaches the reticle.
   */
  idealPower(_from: Vector3, stats: ArmStats): number {
    return 1 - stats.perfectBand;
  }

  start(): void {
    this.charging = true;
    this.chargeTime = 0;
    this.power = 0;
  }

  cancel(): void {
    this.charging = false;
    this.power = 0;
  }

  update(dt: number, _from: Vector3, _stats: ArmStats): void {
    if (this.charging) {
      this.chargeTime += dt;
      this.power = 0.5 - 0.5 * Math.cos((this.chargeTime / METER_PERIOD) * Math.PI * 2);
    }
  }

  /** Full-strength ball speed (Throw Strength raises it). */
  static maxSpeed(stats: ArmStats): number {
    return stats.speed * 1.4;
  }

  /**
   * Let it go: straight along the reticle's 3D direction. The meter is the
   * speed and nothing else; gravity bends the ball from there. A PERFECT
   * release (top of the meter) is full speed with no wobble.
   */
  release(from: Vector3, stats: ArmStats, band: number): ThrowEvent {
    this.charging = false;
    const p = this.power;
    const perfect = p >= 1 - band * 2;
    const speed = Thrower.maxSpeed(stats) * (perfect ? 1 : Math.max(0.1, p));
    const d = tmp.copy(this.dir);
    if (!perfect) {
      // A little wobble off the line, smaller with Accuracy.
      const yaw = ((Math.random() * 2 - 1) * stats.spread * Math.PI) / 180;
      const pitch = ((Math.random() * 2 - 1) * stats.spread * 0.4 * Math.PI) / 180;
      d.applyAxisAngle(UP, yaw);
      const side = new Vector3(d.z, 0, -d.x).normalize();
      if (side.lengthSq() > 0) d.applyAxisAngle(side, -pitch);
    }
    const velocity = d.clone().multiplyScalar(speed);
    // Where it comes down through catch height (or reaches the ground), for receivers to read.
    const g = BALL_GRAVITY;
    const h = from.y > CATCH_HEIGHT ? CATCH_HEIGHT : 0.2;
    const root = velocity.y * velocity.y + 2 * g * (from.y - h);
    const time = Math.max(0.1, root >= 0 ? (velocity.y + Math.sqrt(root)) / g : (2 * Math.max(0, velocity.y)) / g + 0.1);
    const landing = new Vector3(from.x + velocity.x * time, h, from.z + velocity.z * time);
    return { from: from.clone(), velocity, time, landing, perfect, power: p };
  }
}
