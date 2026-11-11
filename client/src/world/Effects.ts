import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
  type Scene,
} from 'three';

const MAX = 260;
const dummy = new Object3D();
const col = new Color();

interface Bit {
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  rot: Vector3;
  life: number;
  max: number;
  size: number;
}

/**
 * Touchdown effects: a burst of pieces in the end zone. The equipped TD
 * effect picks the style (confetti, fireworks, money rain, supernova, hearts)
 * and its colours.
 */
export class Effects {
  private readonly mesh: InstancedMesh;
  private readonly bits: Bit[] = [];

  constructor(scene: Scene) {
    this.mesh = new InstancedMesh(new BoxGeometry(0.28, 0.04, 0.18), new MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Fire the equipped touchdown effect at `at`. */
  touchdown(effectId: string, colors: readonly number[], at: Vector3): void {
    const palette = colors.length ? colors : [0xffe23a];
    const bursts = effectId === 'td-fireworks' || effectId === 'td-galaxy' ? 4 : 1;
    for (let b = 0; b < bursts; b += 1) {
      const center = at.clone().add(new Vector3((Math.random() - 0.5) * 14, effectId === 'td-fireworks' ? 9 + Math.random() * 5 : 0, (Math.random() - 0.5) * 6));
      const n = Math.floor(MAX / bursts / 1.3);
      for (let i = 0; i < n && this.bits.length < MAX; i += 1) {
        const bit: Bit = {
          pos: center.clone(),
          vel: new Vector3(),
          spin: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
          rot: new Vector3(),
          life: 0,
          max: 1.6 + Math.random() * 1.4,
          size: effectId === 'td-cash' ? 2.2 : effectId === 'td-hearts' ? 1.6 : 1,
        };
        if (effectId === 'td-fireworks' || effectId === 'td-galaxy') {
          const d = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
          bit.vel.copy(d).multiplyScalar(9 + Math.random() * 5);
        } else if (effectId === 'td-cash') {
          bit.pos.set(center.x + (Math.random() - 0.5) * 16, 10 + Math.random() * 6, center.z + (Math.random() - 0.5) * 10);
          bit.vel.set(0, -3 - Math.random() * 2, 0);
          bit.max = 3;
        } else {
          bit.vel.set((Math.random() - 0.5) * 10, 9 + Math.random() * 9, (Math.random() - 0.5) * 10);
        }
        (bit as Bit & { color: number }).color = palette[i % palette.length] as number;
        this.bits.push(bit);
      }
    }
  }

  update(dt: number): void {
    for (let i = this.bits.length - 1; i >= 0; i -= 1) {
      const b = this.bits[i] as Bit;
      b.life += dt;
      if (b.life >= b.max) {
        this.bits.splice(i, 1);
        continue;
      }
      b.vel.y -= 12 * dt;
      b.vel.multiplyScalar(1 - 1.4 * dt);
      if (b.vel.y < -4) b.vel.y = -4;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < 0.05) b.pos.y = 0.05;
      b.rot.addScaledVector(b.spin, dt);
    }
    this.mesh.count = this.bits.length;
    this.bits.forEach((b, i) => {
      const fade = Math.min(1, (b.max - b.life) * 2);
      dummy.position.copy(b.pos);
      dummy.rotation.set(b.rot.x, b.rot.y, b.rot.z);
      dummy.scale.setScalar(b.size * fade);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, col.setHex((b as Bit & { color: number }).color));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
