import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  Vector3,
  type Scene,
} from 'three';
import { GRAVITY } from '@mctf/shared';

/** A football is lighter on its feet than a jumping player: gentler arcs, natural throws. */
export const BALL_GRAVITY = GRAVITY * 0.66;
const TRAIL = 22;
const UP = new Vector3(0, 1, 0);
const AXIS = new Vector3(0, 0, 1);
const q = new Quaternion();
const spinQ = new Quaternion();
const dir = new Vector3();
const side = new Vector3();

const ballGeo = new SphereGeometry(0.2, 16, 12);
ballGeo.scale(1, 1, 1.75);
const stripeGeo = new TorusGeometry(0.17, 0.025, 6, 16);
const laceGeo = new BoxGeometry(0.05, 0.03, 0.18);
const ballMat = new MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.6 });
const whiteMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

/** The equipped ball skin: one colour for every football on screen. */
export const setBallSkin = (color: number): void => {
  ballMat.color.setHex(color);
  // Bright skins glow a little so gold / hologram balls read as special.
  const lum = ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11;
  ballMat.emissive.setHex(color === 0x8a4a22 ? 0x000000 : color);
  ballMat.emissiveIntensity = color === 0x8a4a22 ? 0 : lum > 150 ? 0.25 : 0.45;
  ballMat.metalness = color === 0x8a4a22 ? 0 : 0.35;
};

/** The equipped ball trail colour (used when a throw is not PERFECT). */
export let ballTrailColor = 0xffffff;
export const setBallTrail = (color: number): void => {
  ballTrailColor = color;
};

/** Build a football mesh (long axis along +Z). */
export const makeFootball = (): Group => {
  const g = new Group();
  const body = new Mesh(ballGeo, ballMat);
  body.castShadow = true;
  g.add(body);
  for (const z of [-0.2, 0.2]) {
    const s = new Mesh(stripeGeo, whiteMat);
    s.position.z = z;
    s.scale.setScalar(z > 0 ? 0.92 : 0.92);
    g.add(s);
  }
  const lace = new Mesh(laceGeo, whiteMat);
  lace.position.y = 0.2;
  g.add(lace);
  return g;
};

export interface ThrowSolution {
  velocity: Vector3;
  time: number;
}

/**
 * The launch velocity that carries the ball from `from` to `to` with the
 * given horizontal speed (a flat, fast pass for short throws; it climbs on
 * long ones because the time grows).
 */
export const solveThrow = (from: Vector3, to: Vector3, speed: number): ThrowSolution => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const time = Math.max(0.32, dist / speed + dist * dist * 0.00012);
  const vy = (to.y - from.y + 0.5 * BALL_GRAVITY * time * time) / time;
  return { velocity: new Vector3(dx / time, vy, dz / time), time };
};

/** A ball in flight (or rolling), with a glowing trail. */
export class Ball {
  readonly mesh = makeFootball();
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  inFlight = false;
  grounded = false;
  /** Seconds since it last touched the ground. */
  groundTime = 0;
  age = 0;
  private spin = 0;
  private readonly trailPoints: Vector3[] = [];
  private readonly trail: Mesh;
  private readonly trailGeo = new BufferGeometry();
  private readonly trailMat: MeshBasicMaterial;

  constructor(private readonly scene: Scene, color = 0xffffff) {
    const positions = new Float32Array(TRAIL * 2 * 3);
    const alphas = new Float32Array(TRAIL * 2 * 3);
    this.trailGeo.setAttribute('position', new BufferAttribute(positions, 3));
    this.trailGeo.setAttribute('color', new BufferAttribute(alphas, 3));
    const index: number[] = [];
    for (let i = 0; i < TRAIL - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.trailGeo.setIndex(index);
    this.trailMat = new MeshBasicMaterial({
      color,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.trail = new Mesh(this.trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    scene.add(this.mesh, this.trail);
    this.mesh.visible = false;
    this.trail.visible = false;
  }

  setTrailColor(color: number): void {
    this.trailMat.color.setHex(color);
  }

  /** Hold it somewhere (in a hand): not flying, no trail. */
  hold(at: Vector3, facing: number): void {
    this.inFlight = false;
    this.grounded = false;
    this.mesh.visible = true;
    this.trail.visible = false;
    this.trailPoints.length = 0;
    this.position.copy(at);
    this.mesh.position.copy(at);
    this.mesh.rotation.set(0.3, facing, 0);
  }

  launch(from: Vector3, velocity: Vector3): void {
    this.position.copy(from);
    this.velocity.copy(velocity);
    this.inFlight = true;
    this.grounded = false;
    this.groundTime = 0;
    this.age = 0;
    this.mesh.visible = true;
    this.trail.visible = true;
    this.trailPoints.length = 0;
  }

  hide(): void {
    this.inFlight = false;
    this.mesh.visible = false;
    this.trail.visible = false;
    this.trailPoints.length = 0;
  }

  /** Step physics. Returns the previous position for crossing tests. */
  update(dt: number, camera: Vector3): void {
    if (!this.inFlight) {
      this.updateTrail(camera, false);
      return;
    }
    this.age += dt;
    this.velocity.y -= BALL_GRAVITY * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y < 0.2) {
      this.position.y = 0.2;
      if (!this.grounded) this.grounded = true;
      this.velocity.y = Math.abs(this.velocity.y) * 0.35;
      this.velocity.x *= 0.6;
      this.velocity.z *= 0.6;
      if (Math.abs(this.velocity.y) < 1) this.velocity.y = 0;
    }
    if (this.grounded) this.groundTime += dt;
    this.mesh.position.copy(this.position);
    // Point the nose along the flight path and spiral.
    dir.copy(this.velocity);
    if (dir.lengthSq() > 0.5) {
      dir.normalize();
      q.setFromUnitVectors(AXIS, dir);
      this.spin += dt * (this.grounded ? 4 : 22);
      spinQ.setFromAxisAngle(AXIS, this.spin);
      this.mesh.quaternion.copy(q).multiply(spinQ);
    }
    this.updateTrail(camera, !this.grounded);
  }

  private updateTrail(camera: Vector3, add: boolean): void {
    if (add) {
      this.trailPoints.unshift(this.position.clone());
      if (this.trailPoints.length > TRAIL) this.trailPoints.pop();
    } else if (this.trailPoints.length) {
      this.trailPoints.pop();
    }
    const n = this.trailPoints.length;
    this.trail.visible = n > 1;
    if (n < 2) return;
    const pos = this.trailGeo.getAttribute('position') as BufferAttribute;
    const col = this.trailGeo.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < TRAIL; i += 1) {
      const p = this.trailPoints[Math.min(i, n - 1)] as Vector3;
      const next = this.trailPoints[Math.min(i + 1, n - 1)] as Vector3;
      const prev = this.trailPoints[Math.min(Math.max(i - 1, 0), n - 1)] as Vector3;
      dir.subVectors(prev, next);
      side.subVectors(camera, p).cross(dir).normalize();
      const f = i < n ? 1 - i / TRAIL : 0;
      const w = 0.18 * f + 0.02;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
      const a = f * f * 0.9;
      col.setXYZ(i * 2, a, a, a);
      col.setXYZ(i * 2 + 1, a, a, a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh, this.trail);
    this.trailGeo.dispose();
    this.trailMat.dispose();
  }
}

export const UP_VECTOR = UP;
export const tmpColor = new Color();
