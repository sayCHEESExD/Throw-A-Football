import { Bone, Object3D, SkinnedMesh, Quaternion, Vector3 } from 'three';
import { logger } from '../../util/logger.js';
import type { PoseBuffer } from '../PoseBuffer.js';
import { BONE_INDEX, BONE_NAMES, type BoneName } from './boneNames.js';
import { neckScale } from '@mctf/shared';

const SCOPE = 'PlayerRig';

const CHARACTER_RIGHT = new Vector3(1, 0, 0);
const CHARACTER_UP = new Vector3(0, 1, 0);
const CHARACTER_FORWARD = new Vector3(0, 0, 1);

/** Below this magnitude a bone is left at its bind rotation. */
const EPSILON = 1e-5;

/**
 * Local rotations laid over the whole body after the procedural pose - a
 * Bloxity emote (`BloxityEmotes.ts`).
 *
 * Bloxity authors its clips as LOCAL deltas over each bone's bind pose,
 * right-multiplied (`bind * delta`), and names bones the procedural pose
 * never drives (`ArmL_Offset`, `ArmR_Offset`). So an overlay is applied here,
 * in the rig, by bone NAME, rather than squeezed through the character-space
 * `PoseBuffer`: that is the one way the clip lands on `player.glb` exactly as
 * Bloxity's own renderer draws it.
 */
export interface BoneOverlay {
  /** 0..1: how much of the body the overlay holds. At 1 every bound bone is `bind * delta`. */
  readonly weight: number;
  /** Local rotation deltas by bone name. A bound bone with none rests at its bind pose. */
  readonly deltas: ReadonlyMap<string, Quaternion>;
  /** Bones the overlay leaves to the procedural pose. */
  readonly skip?: ReadonlySet<string>;
}

/** A bone outside the twelve that an overlay may name (the `_Offset` shoulders), bound on first use. */
interface ExtraBone {
  bone: Bone;
  restQuaternion: Quaternion;
}

interface BoneBinding {
  bone: Bone;
  /** The bone's local rotation in the FBX bind pose. All poses offset from this. */
  restQuaternion: Quaternion;
  /**
   * The character-space X/Y/Z axes expressed in this bone's PARENT space.
   *
   * player.fbx bakes non-trivial orientations into the rig (LegL1 is authored
   * at 180/90/0, ArmL2 at 0/-104/0, and the whole armature carries a -90 X
   * export correction), so a bone's local axes do not line up with the
   * character's. Resolving the axes once at bind time lets every pose be
   * authored in intuitive character-space terms - "swing the thigh forward" -
   * instead of per-bone magic numbers.
   */
  axisX: Vector3;
  axisY: Vector3;
  axisZ: Vector3;
  /** The quaternion taking character-space vectors into the parent's space. */
  characterToParent: Quaternion;
}

/**
 * Binds the 12 named bones of one cloned player model and applies poses to them.
 *
 * This is the only place that touches `Bone.quaternion`. Every write is
 * `rotation * restQuaternion`, rebuilt from scratch each frame, so repeated
 * posing can never accumulate quaternion error.
 */
export class PlayerRig {
  private readonly bindings = new Map<BoneName, BoneBinding>();

  private readonly scratchRotation = new Quaternion();
  private readonly scratchAxisRotation = new Quaternion();

  /** Bone names that could not be found in the model. Empty when healthy. */
  readonly missingBones: BoneName[] = [];

  /** Every bone of the model by name (first seen = the real joint), for overlays. */
  private readonly allBones: Map<string, Bone>;
  /** Overlay bones outside the twelve, bound lazily; null = the model has no such bone. */
  private readonly extras = new Map<string, ExtraBone | null>();
  /** Extras an overlay moved, so they go back to their bind pose once it lets go. */
  private readonly overlaid = new Set<ExtraBone>();
  /** Character -> parent space, per bound bone: folds an `_Offset` a model lacks onto its arm. */
  private readonly characterToParent = new Map<BoneName, Quaternion>();
  private readonly scratchTarget = new Quaternion();
  private readonly scratchFold = new Quaternion();

  /**
   * @param model      the cloned FBX instance owning the bones
   * @param reference  node defining "character space"; axes are resolved
   *                   relative to it so the rig is independent of world yaw
   */
  constructor(model: Object3D, reference: Object3D) {
    reference.updateMatrixWorld(true);
    const found = collectDeformingBones(model);
    this.allBones = found;

    const referenceWorld = new Quaternion();
    reference.getWorldQuaternion(referenceWorld);
    const referenceWorldInverse = referenceWorld.clone().invert();

    for (const name of BONE_NAMES) {
      const bone = found.get(name);
      if (!bone) {
        this.missingBones.push(name);
        continue;
      }
      const binding = this.createBinding(bone, referenceWorldInverse);
      this.bindings.set(name, binding);
      this.characterToParent.set(name, binding.characterToParent);
    }

    this.enlargeHead();

    if (this.missingBones.length > 0) {
      logger.warn(
        SCOPE,
        `rig is missing ${this.missingBones.length} bone(s):`,
        this.missingBones.join(', '),
        '- those bones will simply not animate',
      );
    }
  }

  /**
   * THE PILOT'S HEAD, A LITTLE LARGER THAN LIFE.
   *
   * The player is three units of person riding nine units of machine, seen
   * from a chase camera that frames the MECH - so the one part of them that is
   * ever above the armour is a head about forty-five hundredths of a unit
   * across, and at playing distance that reads as a detail on the robot rather
   * than as a person on it.
   *
   * Scaled on the NECK BONE, which is where the head geometry hangs, so it
   * costs nothing per frame and it works for the bundled rider and a Bloxity
   * avatar alike - both bind these same twelve names. `applyPose` writes only
   * quaternions, so this survives every frame without being re-applied.
   *
   * Deliberately modest. The head is the read; the BODY still has to look like
   * it belongs to somebody sitting in a cockpit, and a pilot with a balloon for
   * a head is a different art style rather than a clearer one.
   *
   * This is the UNDRESSED case - the bundled rider, and anyone the portal has
   * no proportions for. A dressed avatar's proportions pass writes the same
   * bone and goes through the same `neckScale`, so the two agree.
   */
  private enlargeHead(): void {
    const neck = this.bindings.get('Neck1');
    neck?.bone.scale.setScalar(neckScale());
  }

  /** True when every expected bone was bound. */
  get isComplete(): boolean {
    return this.missingBones.length === 0;
  }

  /**
   * The bone bound to a name, for attaching cosmetics.
   *
   * Anything parented to a returned bone follows the animation automatically.
   * Callers must not write to the bone's rotation - that belongs to applyPose.
   */
  getBone(name: BoneName): Bone | null {
    return this.bindings.get(name)?.bone ?? null;
  }

  get boundBoneCount(): number {
    return this.bindings.size;
  }

  /**
   * Write a pose onto the skeleton, then any overlay over it. Called once per
   * frame. Everything is rebuilt from the bind pose, so nothing compounds.
   */
  applyPose(pose: PoseBuffer, overlay?: BoneOverlay | null): void {
    this.writePose(pose);
    for (const extra of this.overlaid) extra.bone.quaternion.copy(extra.restQuaternion);
    this.overlaid.clear();
    if (overlay && overlay.weight > 1e-4) {
      try {
        this.applyOverlay(overlay);
      } catch {
        // An emote is cosmetic: the procedural pose already written stands.
      }
    }
  }

  /**
   * THE OVERLAY: every bound bone slerps from the procedural pose toward
   * `bind * delta` (the bind pose itself where the clip names no delta), by
   * the overlay's weight - so an emote takes the whole body, as authored, and
   * blends in and out rather than snapping. Bones the clip names beyond the
   * twelve are posed too when the model has them; a name the model lacks is
   * ignored, except that a missing `ArmX_Offset` (the bundled body has none)
   * is folded onto `ArmX1` as the character-space turn it stands for - the
   * offset bone is aligned with the character on Bloxity's rig, so that is the
   * same shoulder swing.
   */
  private applyOverlay(overlay: BoneOverlay): void {
    const weight = Math.min(1, overlay.weight);
    const deltas = overlay.deltas;
    const target = this.scratchTarget;
    const skip = overlay.skip;
    for (const [name, binding] of this.bindings) {
      if (skip?.has(name)) continue;
      target.copy(binding.restQuaternion);
      const delta = deltas.get(name);
      if (delta) target.multiply(delta);
      if (name === 'ArmL1' || name === 'ArmR1') {
        const offsetName = name === 'ArmL1' ? 'ArmL_Offset' : 'ArmR_Offset';
        const offset = deltas.get(offsetName);
        const toParent = this.characterToParent.get(name);
        if (offset && toParent && !this.extraBone(offsetName)) {
          // P * D * P^-1: the offset's turn, expressed about the character's axes in the arm's parent space.
          const fold = this.scratchFold.copy(toParent).multiply(offset);
          fold.multiply(this.scratchRotation.copy(toParent).invert());
          target.premultiply(fold);
        }
      }
      binding.bone.quaternion.slerp(target, weight);
    }
    for (const [name, delta] of deltas) {
      if (BONE_INDEX[name as BoneName] !== undefined || skip?.has(name)) continue;
      const extra = this.extraBone(name);
      if (!extra) continue;
      target.copy(extra.restQuaternion).multiply(delta);
      extra.bone.quaternion.copy(extra.restQuaternion).slerp(target, weight);
      this.overlaid.add(extra);
    }
  }

  /** A bone beyond the twelve, by name, bound the first time an overlay asks for it. */
  private extraBone(name: string): ExtraBone | null {
    let extra = this.extras.get(name);
    if (extra === undefined) {
      const bone = this.allBones.get(name);
      extra = bone ? { bone, restQuaternion: bone.quaternion.clone() } : null;
      this.extras.set(name, extra);
    }
    return extra;
  }

  private writePose(pose: PoseBuffer): void {
    const values = pose.rotations;

    for (const [name, binding] of this.bindings) {
      const at = BONE_INDEX[name] * 3;
      const x = values[at] ?? 0;
      const y = values[at + 1] ?? 0;
      const z = values[at + 2] ?? 0;

      if (Math.abs(x) < EPSILON && Math.abs(y) < EPSILON && Math.abs(z) < EPSILON) {
        binding.bone.quaternion.copy(binding.restQuaternion);
        continue;
      }

      const rotation = this.scratchRotation;
      const axisRotation = this.scratchAxisRotation;

      rotation.setFromAxisAngle(binding.axisX, x);
      if (Math.abs(y) >= EPSILON) {
        axisRotation.setFromAxisAngle(binding.axisY, y);
        rotation.premultiply(axisRotation);
      }
      if (Math.abs(z) >= EPSILON) {
        axisRotation.setFromAxisAngle(binding.axisZ, z);
        rotation.premultiply(axisRotation);
      }

      // Rebuilt from the bind pose every frame - never compounded.
      binding.bone.quaternion.copy(rotation).multiply(binding.restQuaternion);
    }
  }

  /** Restore the untouched bind pose. */
  resetToBindPose(): void {
    for (const binding of this.bindings.values()) {
      binding.bone.quaternion.copy(binding.restQuaternion);
    }
    for (const extra of this.overlaid) extra.bone.quaternion.copy(extra.restQuaternion);
    this.overlaid.clear();
  }

  private createBinding(bone: Bone, referenceWorldInverse: Quaternion): BoneBinding {
    // Character-space -> parent-space, so authored poses read the same for
    // every bone regardless of how the FBX baked its orientation.
    const parentWorld = new Quaternion();
    bone.parent?.getWorldQuaternion(parentWorld);

    const parentInCharacterSpace = referenceWorldInverse.clone().multiply(parentWorld);
    const characterToParent = parentInCharacterSpace.invert();

    return {
      bone,
      restQuaternion: bone.quaternion.clone(),
      axisX: CHARACTER_RIGHT.clone().applyQuaternion(characterToParent).normalize(),
      axisY: CHARACTER_UP.clone().applyQuaternion(characterToParent).normalize(),
      axisZ: CHARACTER_FORWARD.clone().applyQuaternion(characterToParent).normalize(),
      characterToParent: characterToParent.clone(),
    };
  }
}

/**
 * Collect the real joint for each bone name.
 *
 * player.fbx carries TWO skin deformers - one for the arms mesh, one for the
 * body mesh - and FBXLoader resolves them to two DIFFERENT sets of Bone
 * objects that share the same twelve names. For every name there is a real
 * joint plus a zero-length terminal bone parented to it, and the two meshes
 * happen to bind to different sets:
 *
 *   Cube010 (arms) -> the terminal bones
 *   Cube011 (body) -> the real joints
 *
 * Posing the real joints drives both meshes, because each terminal is a CHILD
 * of its real joint and inherits its world transform. Posing the terminals
 * instead would move the arms only and silently leave the body in bind pose.
 *
 * Scene-graph traversal always visits a parent before its child, so keeping
 * the FIRST bone seen for each name reliably selects the real joint.
 */
const collectDeformingBones = (model: Object3D): Map<string, Bone> => {
  const found = new Map<string, Bone>();
  model.traverse((child) => {
    if (child instanceof Bone && !found.has(child.name)) found.set(child.name, child);
  });
  return found;
};

/** Names of the bones each SkinnedMesh binds to, for diagnostics. */
export const describeSkinBindings = (model: Object3D): string[] => {
  const lines: string[] = [];
  model.traverse((child) => {
    if (!(child instanceof SkinnedMesh)) return;
    lines.push(`${child.name}: ${child.skeleton.bones.length} bones`);
  });
  return lines;
};
