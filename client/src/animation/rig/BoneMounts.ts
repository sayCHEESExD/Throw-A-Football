import { PLAYER_HEIGHT } from '@mctf/shared';
import { Matrix4, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import type { PlayerRig } from './PlayerRig.js';

/** One mount: the bone it rides and where on it, as a world matrix in the bind pose. */
export interface MountFrame {
  readonly bone: Bone;
  readonly frame: Matrix4;
}

export interface BodyMounts {
  /** The right hand's grip: +Y the blade, +Z the edge. */
  readonly hand: MountFrame | null;
  /** The left hip, where a scabbard hangs: +Y toward the hilt (forward, up). */
  readonly hip: MountFrame | null;
  /** The centre of the head, axis-aligned with the character. */
  readonly head: MountFrame | null;
  /** Between the shoulder blades, axis-aligned. */
  readonly back: MountFrame | null;
  /** The head's height, for sizing hats. */
  readonly headSize: number;
}

const A = new Vector3();
const B = new Vector3();
const M = new Matrix4();
const Q = new Quaternion();
const S = new Vector3();

/**
 * WHERE THINGS ARE WORN, measured on the body itself.
 *
 * Called with the character's ROOT at the origin, unrotated, in the bind pose.
 * The hand is one forearm past the elbow along the forearm; the hip is beside
 * the pelvis; the head is midway between the neck joint and the top of the
 * character. Measuring rather than hard-coding is what lets the same katana,
 * hat and back banner fit the bundled rig and any Bloxity body.
 */
export const measureMounts = (rig: PlayerRig, root: Object3D, height = PLAYER_HEIGHT): BodyMounts => {
  root.updateMatrixWorld(true);
  const shoulder = rig.getBone('ArmR1');
  const elbow = rig.getBone('ArmR2');
  const hips = rig.getBone('Rig1') ?? rig.getBone('Spine1');
  const neck = rig.getBone('Neck1');
  const chest = rig.getBone('Spine2') ?? rig.getBone('Spine1');
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
  const local = (bone: Bone, out: Vector3): Vector3 => bone.getWorldPosition(out).applyMatrix4(rootInverse);

  let hand: MountFrame | null = null;
  if (shoulder && elbow) {
    const a = local(shoulder, A);
    const b = local(elbow, B);
    const forearm = new Vector3().subVectors(b, a);
    const length = Math.max(forearm.length(), 0.3);
    forearm.normalize();
    const grip = b.clone().addScaledVector(forearm, length * 0.92);
    const blade = new Vector3(0, 0, 1).addScaledVector(forearm, -forearm.z);
    if (blade.lengthSq() < 1e-4) blade.set(0, 1, 0);
    blade.normalize();
    const edge = forearm.clone().addScaledVector(blade, -forearm.dot(blade)).normalize();
    const side = new Vector3().crossVectors(blade, edge).normalize();
    hand = { bone: elbow, frame: new Matrix4().makeBasis(side, blade, edge).setPosition(grip) };
  }

  let hip: MountFrame | null = null;
  if (hips) {
    const pelvis = local(hips, A);
    const hilt = new Vector3(0, 0.55, 1).normalize();
    const edge = new Vector3(0, 1, 0).addScaledVector(hilt, -hilt.y).normalize();
    const side = new Vector3().crossVectors(hilt, edge).normalize();
    const at = new Vector3(0.62, Math.max(0.9, pelvis.y - 0.1), 0.25);
    hip = { bone: hips, frame: new Matrix4().makeBasis(side, hilt, edge).setPosition(at) };
  }

  let head: MountFrame | null = null;
  let headSize = height * 0.28;
  if (neck) {
    const n = local(neck, A);
    headSize = Math.max(0.4, height - n.y);
    head = { bone: neck, frame: new Matrix4().makeTranslation(0, (n.y + height) / 2, 0.02) };
  }

  let back: MountFrame | null = null;
  if (chest) {
    const c = local(chest, A);
    back = { bone: chest, frame: new Matrix4().makeTranslation(0, c.y + 0.35, -0.42) };
  }

  return { hand, hip, head, back, headSize };
};

/**
 * Parent `object` to a mount's bone so that it sits at the mount's frame now,
 * and follows the bone from then on. `root` must still be at the origin.
 */
export const attachToMount = (object: Object3D, mount: MountFrame, root: Object3D): void => {
  object.removeFromParent();
  mount.bone.updateMatrixWorld(true);
  const want = new Matrix4().multiplyMatrices(root.matrixWorld, mount.frame);
  M.copy(mount.bone.matrixWorld).invert().multiply(want);
  M.decompose(object.position, Q, S);
  object.quaternion.copy(Q);
  object.scale.copy(S);
  mount.bone.add(object);
};
