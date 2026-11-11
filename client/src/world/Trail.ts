import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Scene,
} from 'three';

const POINTS = 26;
const c = new Color();

/**
 * The equipped run trail: a glowing vertical ribbon left behind someone who
 * is running (the lobby player, the ball carrier). Colours cycle along its
 * length for multi-colour trails.
 */
export class Trail {
  private readonly pts: Vector3[] = [];
  private readonly geo = new BufferGeometry();
  private readonly mesh: Mesh;
  private colors: number[] = [0xffffff];
  private dropClock = 0;

  constructor(private readonly scene: Scene) {
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(POINTS * 2 * 3), 3));
    this.geo.setAttribute('color', new BufferAttribute(new Float32Array(POINTS * 2 * 3), 3));
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(index);
    this.mesh = new Mesh(
      this.geo,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setColors(colors: readonly number[]): void {
    this.colors = colors.length ? [...colors] : [0xffffff];
  }

  /** Feed the runner's position every frame; `moving` grows the trail, otherwise it fades away. */
  update(dt: number, at: Vector3, moving: boolean): void {
    this.dropClock += dt;
    if (moving && this.dropClock > 0.025) {
      this.dropClock = 0;
      this.pts.unshift(at.clone());
      if (this.pts.length > POINTS) this.pts.pop();
    } else if (!moving && this.pts.length && this.dropClock > 0.02) {
      this.dropClock = 0;
      this.pts.pop();
    }
    if (moving && this.pts.length) this.pts[0]!.copy(at);
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    const pos = this.geo.getAttribute('position') as BufferAttribute;
    const col = this.geo.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < POINTS; i += 1) {
      const p = this.pts[Math.min(i, n - 1)] as Vector3;
      const f = i < n ? 1 - i / POINTS : 0;
      const h = 0.25 + 0.95 * f;
      pos.setXYZ(i * 2, p.x, p.y + 0.35, p.z);
      pos.setXYZ(i * 2 + 1, p.x, p.y + 0.35 + h, p.z);
      c.setHex(this.colors[Math.floor((i / POINTS) * this.colors.length) % this.colors.length] as number).multiplyScalar(f * 0.85);
      col.setXYZ(i * 2, c.r, c.g, c.b);
      col.setXYZ(i * 2 + 1, c.r * 0.3, c.g * 0.3, c.b * 0.3);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  clear(): void {
    this.pts.length = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geo.dispose();
  }
}
