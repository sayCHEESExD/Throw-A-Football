import {
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Bone,
  type Texture,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { neckScale, type AvatarAppearance } from '@mctf/shared';
import { logger } from '../util/logger.js';
import {
  ACCESSORY_RIG,
  defaultSkinUrl,
  REST_INVERSE_KEY,
  accessoryUrls,
  assetUrl,
  describeItem,
  headItemUrls,
  plainSkinUrl,
  skinTextureUrl,
  type AccessorySlot,
} from './bloxityAssets.js';
import { isEquippedId, type LegionProportions } from './legionTypes.js';

const SCOPE = 'bloxity/avatar';

/**
 * Bloxity cosmetics, applied to one rider (local or remote).
 *
 * Three things are applied, and the choice of which three is deliberate:
 *
 *  - the SKIN, as a texture swap on the rider's own material - with the worn
 *    face, shirt and pants already composited onto it by Bloxity;
 *  - the HAT, HAIR, MASK and BACK item, as meshes parented to real bones, and
 *    the NECK / CHEST / WAIST / HAND / SHOES accessories, hung off the rest
 *    pose captured when `player.glb` loaded (Bloxity body only);
 *  - the PROPORTIONS, as scales and offsets on those same bones.
 *
 * The body PARTS are not applied here: those replace geometry on the body
 * itself and so belong to whatever built it - see `BloxityRiderFactory`. This
 * class dresses whichever rider is currently mounted, Bloxity body or bundled
 * `player.fbx`, which is why `rebind` exists.
 */
export class BloxityAvatar {
  private riderVisual: Group;
  /** The rider model, which pair accessories are added under. */
  private model: Object3D;
  private bones: ReadonlyMap<string, Bone>;
  /** True while the rider is a Bloxity body rather than the bundled one. */
  private wearingBloxityBody = false;
  /** A texture worn instead of any catalogue skin (NPC uniforms painted on the atlas). */
  private fixedSkin: Texture | null = null;

  /** The rider's own material, cloned so remote players keep the default. */
  private material: MeshStandardMaterial | null = null;
  /** The texture the model shipped with, to go back to when a skin is removed. */
  private defaultMap: Texture | null = null;

  /** Everything worn in a slot, with the material and texture it owns. */
  private readonly attachments = new Map<
    WornSlot,
    { nodes: Object3D[]; material: MeshStandardMaterial; texture: Texture }
  >();
  private readonly loadedTextures: Texture[] = [];

  /*
   * What is currently WORN in each slot.
   *
   * THREE states, not two: a MISSING key means "nothing has been applied to
   * this body yet", `null` means "applied, and the answer was none".
   *
   * Collapsing those two is a real bug and it shipped. A rebind used to set
   * these to `null` to mean "re-wear everything", but for a player with no
   * skin equipped the WANTED value is also `null` - so the comparison matched,
   * the load was skipped, and a freshly built Bloxity body was left with no
   * texture at all, which renders white. A rebind therefore CLEARS the map.
   */
  private readonly current = new Map<WornSlot, string | null>();
  /** The skin key (skin|pants|shirt|face); undefined until applied to this body. */
  private currentSkin: string | undefined = undefined;

  private readonly objLoader = new OBJLoader();
  private readonly textureLoader = new TextureLoader();

  private disposed = false;

  constructor(riderVisual: Group, riderModel: Object3D) {
    this.riderVisual = riderVisual;
    this.model = riderModel;
    this.bones = collectBones(riderModel);
    this.material = this.cloneRiderMaterial(riderModel);
    this.defaultMap = this.material?.map ?? null;
  }

  /**
   * Wear what the account has equipped.
   *
   * Safe to call on every avatar event: each slot is compared against what is
   * already worn, so the common case - a proportions change - touches no
   * network at all.
   */
  /** Wear this painted atlas on the Bloxity body instead of a catalogue skin. */
  setFixedSkin(texture: Texture | null): void {
    this.fixedSkin = texture;
    this.currentSkin = undefined;
  }

  apply(equipped: AvatarAppearance, proportions: LegionProportions): void {
    if (this.disposed) return;

    this.applySkin(equipped);
    void this.applyItem('hat', equipped.hatId);
    void this.applyItem('hair', equipped.hairId);
    void this.applyItem('mask', equipped.maskId);
    void this.applyItem('back', equipped.backId);
    void this.applyAccessory('neck', equipped.neckId);
    void this.applyAccessory('chest', equipped.chestId);
    void this.applyAccessory('waist', equipped.waistId);
    void this.applyAccessory('hand', equipped.handId);
    void this.applyAccessory('shoes', equipped.shoesId);
    this.applyProportions(proportions);
  }

  /**
   * Follow the rider onto a new body.
   *
   * Called when the mount swaps in a Bloxity avatar, or swaps back to the
   * bundled one. Everything this class holds is bound to a particular model -
   * the bones it hangs items on, the material it re-skins - so a swap has to
   * re-collect all of it and then re-wear what was already worn, which is what
   * forgetting the worn state arranges: the next `apply` sees every slot as
   * changed and puts it back on the new body.
   */
  rebind(riderVisual: Group, riderModel: Object3D, bloxityBody: boolean): void {
    for (const slot of [...this.attachments.keys()]) this.detach(slot);

    this.riderVisual = riderVisual;
    this.model = riderModel;
    this.bones = collectBones(riderModel);
    this.material = this.cloneRiderMaterial(riderModel);
    this.defaultMap = this.material?.map ?? null;
    this.wearingBloxityBody = bloxityBody;

    // CLEARED, not nulled: "not applied to this body yet". See the fields.
    this.currentSkin = undefined;
    this.current.clear();
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of [...this.attachments.keys()]) this.detach(slot);
    for (const texture of this.loadedTextures) texture.dispose();
    this.loadedTextures.length = 0;
    this.material?.dispose();
    this.material = null;
  }

  // ------------------------------------------------------------------ skin

  private applySkin(look: AvatarAppearance): void {
    const id = (value: string): string => (isEquippedId(value) ? value : '');
    const layers: SkinLayers = {
      skinId: id(look.skinId),
      pantsId: id(look.pantsId),
      shirtId: id(look.shirtId),
      faceId: id(look.faceId),
    };
    const key = [layers.skinId, layers.pantsId, layers.shirtId, layers.faceId].join('|');
    if (key === this.currentSkin) return;
    this.currentSkin = key;
    void this.loadSkin(key, layers);
  }

  /**
   * Put a skin on the body.
   *
   * On a Bloxity body the texture comes from Bloxity's compositor whenever a
   * face, shirt or pants is worn (`skinTextureUrl`) - built from the replicated
   * ids, so the local player and every remote one fetch the identical URL.
   * With no clothing layer it is the plain skin: the catalogue's texture path
   * when the id resolves (the built-in default's id is not its file name),
   * else `/skins/{id}.png`, else Bloxity's default skin.
   *
   * The bundled rider wears a plain skin or the texture it shipped with: it
   * has none of the GLB's UVs, so a composited outfit means nothing on it.
   */
  private async loadSkin(wanted: string, layers: SkinLayers): Promise<void> {
    const material = this.material;
    if (!material) return;

    if (this.fixedSkin && this.wearingBloxityBody) {
      material.map = this.fixedSkin;
      material.needsUpdate = true;
      return;
    }
    let url: string | null = this.wearingBloxityBody ? skinTextureUrl(layers) : null;
    if (!url && layers.skinId) {
      const item = await describeItem(layers.skinId);
      const path = item?.assetPaths?.texture;
      if (path) url = assetUrl(path);
      else if (this.wearingBloxityBody) url = plainSkinUrl(layers.skinId);
    } else if (!url && this.wearingBloxityBody) {
      url = defaultSkinUrl();
    }

    // Still wanted? The player may have changed skin while this was in flight.
    if (this.disposed || this.currentSkin !== wanted) return;

    if (!url) {
      material.map = this.defaultMap;
      material.needsUpdate = true;
      return;
    }

    this.textureLoader.load(
      url,
      (texture) => {
        if (this.disposed || this.currentSkin !== wanted) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = false;
        // Bloxity skins are pixel art. Smoothing them turns a face into a
        // smudge, which is why their own renderer filters them this way too.
        texture.magFilter = NearestFilter;
        texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        this.loadedTextures.push(texture);
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => logger.warn(SCOPE, `skin ${url} failed to load`),
    );
  }

  // ------------------------------------------------------------------ items

  /**
   * Parent a hat, hair, mask or back item to a real bone.
   *
   * To a BONE, not to the rider group: an item hung off the group would keep
   * its own idea of where the head is while the head moved, which is the same
   * class of mistake as copying a transform a frame late.
   *
   * Hats and back items come from the catalogue's `assetPaths`. Hair and masks
   * are their own slots, worn together with a hat, and are stored where hats
   * are: `/items/hats/{id}.obj` + `/textures/hats/{id}.png`, on `Neck1` at
   * (0, 0.8, 0) exactly like a hat.
   */
  private async applyItem(slot: 'hat' | 'hair' | 'mask' | 'back', id: string): Promise<void> {
    const wanted = this.claim(slot, id);
    if (!wanted) return;

    const anchor = this.bones.get(slot === 'back' ? 'Spine2' : 'Neck1');
    if (!anchor) {
      logger.warn(SCOPE, `no bone to hang a ${slot} on`);
      return;
    }

    let urls: ItemUrls | null = null;
    if (slot === 'hair' || slot === 'mask') {
      urls = headItemUrls(wanted);
    } else {
      // The catalogue knows where the item lives; nothing here guesses.
      const item = await describeItem(wanted);
      const meshPath = item?.assetPaths?.mesh;
      const texturePath = item?.assetPaths?.texture;
      if (meshPath && texturePath) urls = { mesh: assetUrl(meshPath), texture: assetUrl(texturePath) };
    }
    if (!urls) {
      logger.warn(SCOPE, `${slot} ${wanted} has no mesh in the catalogue`);
      return;
    }

    const loaded = await this.loadItem(slot, wanted, urls);
    if (!loaded) return;

    // An item is sized against the BONE it hangs on, and the two bodies do
    // not share a bone space: `player.fbx` is authored in centimetres and
    // scaled down on load, while the Bloxity body is the rig these items
    // were made for. So a Bloxity body gets Bloxity's own numbers - scale 1,
    // a head item lifted 0.8 up the head bone, a back item sitting on the
    // spine - and the bundled body keeps the values tuned for it.
    const { object } = loaded;
    const native = this.wearingBloxityBody;
    object.scale.setScalar(native ? 1 : ITEM_SCALE);
    if (slot === 'back') object.position.set(0, 0, native ? 0 : BACK_OFFSET);
    else object.position.set(0, native ? BLOXITY_HAT_LIFT : HAT_LIFT, 0);

    anchor.add(object);
    this.attachments.set(slot, { nodes: [object], material: loaded.material, texture: loaded.texture });
    logger.info(SCOPE, `wearing ${slot} ${wanted}`);
  }

  /**
   * Hang a neck, chest, waist, hand or shoes accessory off the rest pose.
   *
   * Per the SDK's spec each item's local matrix is
   * `restInverse(bone) * translate(origin)`, using the model-space rest
   * transforms captured when `player.glb` loaded - NOT `skeleton.boneInverses`,
   * whose leaf entries in player.glb are 90 degrees off their rest pose.
   *
   * Hands and shoes are a PAIR: the mesh on the left leaf bone and a copy
   * mirrored across X (`restInverse(right) * scale(-1, 1, 1) * translate`) on
   * the right. They follow their bone's position and rotation only, never its
   * scale, so each sits in a `BoneFollower` rather than under the bone.
   *
   * Proportions in this game are applied by MOVING AND SCALING BONES (see
   * `applyProportions`), not by editing `skeleton.boneMatrices`, so every
   * accessory follows them on its own: the singles inherit their spine bone's
   * scale, and the pairs track their leaf bone wherever a shoulder or a
   * straddle has moved it. No compensating offsets are applied.
   *
   * Only on a Bloxity body: the bundled `player.fbx` has no leaf bones and no
   * captured rest pose, and these items are authored for player.glb.
   */
  private async applyAccessory(slot: AccessorySlot, id: string): Promise<void> {
    const wanted = this.claim(slot, id);
    if (!wanted || !this.wearingBloxityBody) return;

    const rest = this.model.userData[REST_INVERSE_KEY] as Record<string, number[]> | undefined;
    const rig = ACCESSORY_RIG[slot];
    const anchors = rig.bones.map((name) => ({ bone: this.bones.get(name), rest: rest?.[name] }));
    if (anchors.some((anchor) => !anchor.bone || !anchor.rest)) {
      logger.warn(SCOPE, `no rest pose to hang a ${slot} on`);
      return;
    }

    const loaded = await this.loadItem(slot, wanted, accessoryUrls(slot, wanted));
    if (!loaded) return;

    const origin = new Matrix4().makeTranslation(rig.origin[0], rig.origin[1], rig.origin[2]);
    const nodes: Object3D[] = [];
    anchors.forEach((anchor, index) => {
      const bone = anchor.bone as Bone;
      const local = new Matrix4().fromArray(anchor.rest as number[]);
      if (index === 1) local.multiply(MIRROR_X);
      local.multiply(origin);

      // The right copy shares the left's geometry and material.
      const object = index === 0 ? loaded.object : loaded.object.clone();
      if (rig.pair) {
        const follower = new BoneFollower(bone, local);
        follower.add(object);
        // Under the MODEL, after the skeleton, so the bone's world matrix is
        // already this frame's when the follower reads it.
        this.model.add(follower);
        nodes.push(follower);
      } else {
        local.decompose(object.position, object.quaternion, object.scale);
        bone.add(object);
        nodes.push(object);
      }
    });

    this.attachments.set(slot, { nodes, material: loaded.material, texture: loaded.texture });
    logger.info(SCOPE, `wearing ${slot} ${wanted}`);
  }

  /**
   * Record what a slot should now wear and take off what it wore.
   *
   * Returns undefined when nothing changed (no work to do), null when the slot
   * is now empty, else the id to load.
   */
  private claim(slot: WornSlot, id: string | null | undefined): string | null | undefined {
    const wanted = isEquippedId(id) ? id : null;
    if (this.current.has(slot) && this.current.get(slot) === wanted) return undefined;
    this.current.set(slot, wanted);
    this.detach(slot);
    return wanted;
  }

  private detach(slot: WornSlot): void {
    const worn = this.attachments.get(slot);
    if (!worn) return;
    for (const node of worn.nodes) node.removeFromParent();
    worn.material.dispose();
    worn.texture.dispose();
    this.attachments.delete(slot);
  }

  /**
   * Load one OBJ item and its texture, or null if it failed or went stale.
   *
   * NO `flipY = false` HERE, AND THAT IS THE WHOLE DIFFERENCE from the skin.
   * The skin turns it off because it is applied to the GLB body, and glTF puts
   * the UV origin at the TOP left. An item is an OBJ, which uses the OpenGL
   * convention with the origin at the BOTTOM left - three.js's default.
   * Forcing the glTF rule onto it flipped every hat vertically, which reads as
   * smeared garbage. Bloxity's own renderer sets `flipY` only on the skin.
   */
  private async loadItem(
    slot: WornSlot,
    wanted: string,
    urls: ItemUrls,
  ): Promise<{ object: Object3D; material: MeshStandardMaterial; texture: Texture } | null> {
    try {
      const [object, texture] = await Promise.all([
        this.objLoader.loadAsync(urls.mesh),
        this.textureLoader.loadAsync(urls.texture),
      ]);
      // Still wanted? The player may have changed it while this was in flight.
      if (this.disposed || this.current.get(slot) !== wanted || this.attachments.has(slot)) {
        texture.dispose();
        return null;
      }

      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;

      const material = new MeshStandardMaterial({ map: texture, roughness: 0.85 });
      object.traverse((child) => {
        if (child instanceof Mesh) {
          child.material = material;
          child.castShadow = true;
        }
      });
      return { object, material, texture };
    } catch {
      logger.warn(SCOPE, `${slot} ${wanted} failed to load`);
      return null;
    }
  }

  // ----------------------------------------------------------- proportions

  /**
   * Apply the account's proportions.
   *
   * Scale and POSITION only - never rotation. `PlayerRig` rebuilds every
   * bone's quaternion from its rest pose on every single frame, so a rotation
   * written here would be gone before it was drawn; scale and position are
   * untouched by it and therefore survive.
   *
   * Because proportions MOVE AND SCALE BONES (rather than editing
   * `skeleton.boneMatrices`), every accessory follows them automatically.
   */
  private applyProportions(p: LegionProportions): void {
    const num = (value: number, fallback = 1): number =>
      Number.isFinite(value) && value > 0 ? value : fallback;

    // Height scales the whole rider. The robot's seat is a fixed point, so
    // this grows the rider upward from where they sit rather than through the
    // robot's back.
    this.riderVisual.scale.setScalar(num(p.height));

    const spine1 = this.bones.get('Spine1');
    if (spine1) spine1.scale.x = num(p.torsoScaleX);

    const spine2 = this.bones.get('Spine2');
    if (spine2) spine2.scale.x = num(p.shoulderWidth);

    /*
     * The portal's head proportion, TIMES this game's own.
     *
     * Not `setScalar(num(p.headScale))`. That ran after the rig was bound and
     * overwrote the enlargement the pilot needs to be recognisable from the
     * chase camera, putting almost every player back on a head scale of
     * exactly 1. `neckScale` multiplies the two, so a player's own choice
     * still does what they chose.
     */
    const neck = this.bones.get('Neck1');
    if (neck) neck.scale.setScalar(neckScale(num(p.headScale)));

    for (const name of ['ArmL1', 'ArmR1'] as const) {
      const bone = this.bones.get(name);
      if (bone) bone.scale.y = num(p.armLength);
    }

    // `legOffsetX` is a straddle, so it moves the legs apart rather than
    // scaling them: the rider is sitting on a barrel, and that is the one
    // proportion this game's pose actually cares about.
    const straddle = Number.isFinite(p.legOffsetX) ? p.legOffsetX : 1;
    for (const [name, side] of [['LegL1', 1], ['LegR1', -1]] as const) {
      const bone = this.bones.get(name);
      if (!bone) continue;
      bone.position.x = bone.userData['restX'] as number ?? bone.position.x;
      if (bone.userData['restX'] === undefined) bone.userData['restX'] = bone.position.x;
      bone.position.x = (bone.userData['restX'] as number) + side * (straddle - 1) * LEG_SPREAD;
    }
  }

  /**
   * Give the local rider its own material.
   *
   * Every instance shares ONE material by design, which is exactly right until
   * one of them needs a different skin - at which point writing to it would
   * re-skin every remote player too.
   */
  private cloneRiderMaterial(model: Object3D): MeshStandardMaterial | null {
    let cloned: MeshStandardMaterial | null = null;
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const material = child.material;
      if (!(material instanceof MeshStandardMaterial)) return;
      cloned ??= material.clone();
      child.material = cloned;
    });
    return cloned;
  }
}

/** Every slot that hangs a mesh off the body. */
type WornSlot = 'hat' | 'hair' | 'mask' | 'back' | AccessorySlot;

interface ItemUrls {
  readonly mesh: string;
  readonly texture: string;
}

interface SkinLayers {
  readonly skinId: string;
  readonly pantsId: string;
  readonly shirtId: string;
  readonly faceId: string;
}

/** How big a CDN item is, in the bone space it hangs in. */
const ITEM_SCALE = 0.9;
/** A hat sits above the head bone's origin, on the bundled body. */
const HAT_LIFT = 0.55;
/**
 * The same lift on a Bloxity body.
 *
 * Bloxity's own figure, not a tuned one: their renderer parents a hat (and
 * hair, and a mask) to the head bone at `(0, 0.8, 0)`.
 */
const BLOXITY_HAT_LIFT = 0.8;
/** A back item sits behind the chest. */
const BACK_OFFSET = -0.35;
/** World units the legs move apart per unit of `legOffsetX`. */
const LEG_SPREAD = 0.12;

const MIRROR_X = new Matrix4().makeScale(-1, 1, 1);

const followPosition = new Vector3();
const followRotation = new Quaternion();
const followScale = new Vector3();
const scratchPosition = new Vector3();
const scratchRotation = new Quaternion();
const scratchScale = new Vector3();

/**
 * Holds a pair accessory (hand, shoe) on a bone by POSITION AND ROTATION only.
 *
 * Every matrix pass its world matrix becomes
 * `compose(bone world position, bone world rotation, S) * local`. S is the
 * character's own scale - the world scale of the model it sits under (rider
 * size, height proportion, the GLB-to-world factor) - which is the spec's
 * "scale 1" expressed in this scene; what is deliberately dropped is any scale
 * on the BONES (arm length, shoulder width, head size).
 *
 * Parented under the rider model AFTER the skeleton, so in the renderer's
 * depth-first matrix pass the bone has always been updated first.
 */
class BoneFollower extends Object3D {
  private readonly bone: Object3D;
  private readonly local: Matrix4;

  constructor(bone: Object3D, local: Matrix4) {
    super();
    this.bone = bone;
    this.local = local;
    this.matrixAutoUpdate = false;
  }

  override updateMatrixWorld(_force?: boolean): void {
    this.bone.matrixWorld.decompose(followPosition, followRotation, scratchScale);
    if (this.parent) this.parent.matrixWorld.decompose(scratchPosition, scratchRotation, followScale);
    else followScale.set(1, 1, 1);
    this.matrixWorld.compose(followPosition, followRotation, followScale).multiply(this.local);
    this.matrixWorldNeedsUpdate = false;
    for (const child of this.children) child.updateMatrixWorld(true);
  }

  override updateWorldMatrix(updateParents: boolean, _updateChildren: boolean): void {
    if (updateParents) this.bone.updateWorldMatrix(true, false);
    this.updateMatrixWorld(true);
  }
}

/** The rig's bones, by name. Same first-bone rule `PlayerRig` uses. */
const collectBones = (model: Object3D): Map<string, Bone> => {
  const found = new Map<string, Bone>();
  model.traverse((child) => {
    const bone = child as Bone;
    if (bone.isBone && !found.has(bone.name)) found.set(bone.name, bone);
  });
  return found;
};
