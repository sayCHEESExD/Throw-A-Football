import { Box3, Group, Vector3, type Mesh, type Object3D } from 'three';
import {
  BLOXITY_EMOTE,
  DEFAULT_APPEARANCE,
  DEFAULT_PROPORTIONS,
  sameAppearance,
  sameProportions,
  type AvatarAppearance,
  type AvatarProportions,
} from '@mctf/shared';
import { BloxityAvatar } from '../bloxity/BloxityAvatar.js';
import { bloxityRiderFactory } from '../bloxity/BloxityRiderFactory.js';
import { PoseBuffer } from '../animation/PoseBuffer.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { BloxityEmotePlayer, emoteSecondsSince } from '../animation/BloxityEmotes.js';
import { playerModelLoader } from '../player/PlayerModelLoader.js';
import { NPC_HEIGHT } from './NpcBody.js';

export type AvatarPose = 'free' | 'aim' | 'throw' | 'cheer' | 'down';

const damp = (a: number, b: number, rate: number, dt: number): number => a + (b - a) * (1 - Math.exp(-rate * dt));
const bump = (t: number, a: number, b: number): number => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

const tmpA = new Vector3();
const tmpB = new Vector3();

/**
 * A player's own Bloxity avatar: their body, skin, clothing, accessories and
 * proportions exactly as the portal has them. Never dressed in a uniform.
 */
export class Avatar {
  readonly root = new Group();
  /** Normalises whichever body is mounted to the game's character height. */
  private readonly norm = new Group();
  /** Bloxity's proportions scale this one. */
  private readonly visual = new Group();
  private model: Object3D;
  private rig: PlayerRig;
  private readonly dresser: BloxityAvatar;
  private readonly pose = new PoseBuffer();
  private readonly emotePlayer = new BloxityEmotePlayer();

  private appearance: AvatarAppearance = DEFAULT_APPEARANCE;
  private proportions: AvatarProportions = DEFAULT_PROPORTIONS;
  private bodyKey = '';
  private bodyToken = 0;
  private looked = false;
  private disposed = false;

  // Animation inputs.
  speed = 0;
  grounded = true;
  holdingBall = false;
  state: AvatarPose = 'free';
  /** Bloxity emote id and its start (server ms). */
  emoteId = '';
  emoteStart = 0;

  private stateTime = 0;
  private lastState: AvatarPose = 'free';
  private phase = 0;
  private time = Math.random() * 10;
  private move = 0;
  private air = 0;
  private hold = 0;

  constructor() {
    this.model = playerModelLoader.createInstance();
    this.visual.add(this.model);
    this.norm.add(this.visual);
    this.root.add(this.norm);
    this.rig = new PlayerRig(this.model, this.model);
    this.dresser = new BloxityAvatar(this.visual, this.model);
    this.fitHeight();
    this.castShadows();
  }

  /** Wear this look. Cheap to call repeatedly: unchanged looks do nothing. */
  setLook(appearance: AvatarAppearance, proportions: AvatarProportions): void {
    if (this.disposed) return;
    if (this.looked && sameAppearance(appearance, this.appearance) && sameProportions(proportions, this.proportions)) return;
    this.looked = true;
    this.appearance = appearance;
    this.proportions = proportions;
    const key = [appearance.headId, appearance.torsoId, appearance.armLId, appearance.armRId, appearance.legLId, appearance.legRId].join('|');
    if (key !== this.bodyKey) {
      this.bodyKey = key;
      void this.rebuildBody(appearance);
    }
    this.dresser.apply(appearance, proportions);
  }

  private async rebuildBody(appearance: AvatarAppearance): Promise<void> {
    const token = (this.bodyToken += 1);
    const model = await bloxityRiderFactory.build(appearance);
    if (this.disposed || token !== this.bodyToken || !model) return;
    this.model.removeFromParent();
    this.model = model;
    this.visual.add(model);
    this.rig = new PlayerRig(model, model);
    this.dresser.rebind(this.visual, model, true);
    this.dresser.apply(this.appearance, this.proportions);
    this.fitHeight();
    this.castShadows();
  }

  private fitHeight(): void {
    const keep = this.visual.scale.x;
    this.visual.scale.setScalar(1);
    this.norm.scale.setScalar(1);
    this.rig.applyPose(new PoseBuffer());
    this.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    // The default model's feet sit at y = 0; scale it to a footballer's height.
    this.norm.scale.setScalar(h > 0.2 && h < 50 ? NPC_HEIGHT / h : 1);
    this.visual.scale.setScalar(keep);
  }

  private castShadows(): void {
    this.model.traverse((c) => {
      const m = c as Mesh;
      if (m.isMesh) m.castShadow = true;
    });
  }

  /** Where the right hand is, for carrying and releasing the ball. */
  handPosition(out: Vector3): Vector3 {
    const upper = this.rig.getBone('ArmR1');
    const lower = this.rig.getBone('ArmR2');
    if (!upper || !lower) return out.copy(this.root.position).setY(this.root.position.y + 1.8);
    upper.getWorldPosition(tmpA);
    lower.getWorldPosition(tmpB);
    return out.copy(tmpB).sub(tmpA).multiplyScalar(0.95).add(tmpB);
  }

  setState(state: AvatarPose): void {
    this.state = state;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.state !== this.lastState) {
      this.lastState = this.state;
      this.stateTime = 0;
    }
    this.stateTime += dt;
    const p = this.pose;
    p.reset();
    this.move = damp(this.move, Math.min(1, this.speed / 3), 8, dt);
    const run = Math.min(1, Math.max(0, (this.speed - 8) / 7));
    this.air = damp(this.air, this.grounded ? 0 : 1, 10, dt);
    this.hold = damp(this.hold, this.holdingBall ? 1 : 0, 12, dt);

    const free = this.speed < BLOXITY_EMOTE.stopSpeed && this.state === 'free' && !this.holdingBall;
    try {
      this.emotePlayer.update(dt, this.time, this.emoteId, this.emoteId ? emoteSecondsSince(this.emoteStart) : 0, free);
    } catch {
      this.emotePlayer.clear();
    }

    if (this.speed > 0.2) this.phase = (this.phase + (this.speed / (4.4 + run * 2)) * Math.PI * dt) % (Math.PI * 2);
    const sin = Math.sin(this.phase);
    const cos = Math.cos(this.phase);
    const ground = 1 - this.air;
    const legs = (0.7 + run * 0.25) * this.move * ground;
    p.add('LegL1', -legs * sin);
    p.add('LegR1', legs * sin);
    p.add('LegL2', (0.35 + run * 0.4) * Math.max(0, cos) * this.move * ground);
    p.add('LegR2', (0.35 + run * 0.4) * Math.max(0, -cos) * this.move * ground);
    const arms = (0.7 + run * 0.35) * this.move * ground;
    p.add('ArmL1', arms * sin * (1 - this.hold * 0.6), 0, 0.06);
    p.add('ArmR1', -arms * sin * (1 - this.hold), 0, -0.06);
    p.add('Spine1', (-0.04 - 0.12 * run) * this.move);
    const still = (1 - this.move) * ground;
    p.add('Spine1', Math.sin(this.time * 2.2) * 0.025 * still);
    p.add('LegL1', -0.5 * this.air);
    p.add('LegR1', 0.3 * this.air);
    p.add('ArmL1', -0.3 * this.air, 0, 1.0 * this.air * (1 - this.hold));

    // Ball carried at the chest, in both hands.
    const h = this.hold;
    p.add('ArmR1', -0.95 * h, 0, 0.25 * h);
    p.add('ArmR2', -1.1 * h);
    p.add('ArmL1', -0.75 * h, 0, -0.3 * h);
    p.add('ArmL2', -1.0 * h);

    const t = this.stateTime;
    switch (this.state) {
      case 'aim': {
        // Wind up: ball back by the ear, off arm pointing at the target.
        const k = Math.min(1, t * 6);
        p.add('ArmR1', (-1.65 + 0.95) * k, 0.25 * k, -0.25 * k);
        p.add('ArmR2', (-1.2 + 1.1) * k);
        p.add('ArmL1', (-1.35 + 0.75) * k, 0, 0.3 * k);
        p.add('ArmL2', 1.0 * k);
        p.add('Spine1', -0.05 * k, 0.45 * k);
        p.add('Neck1', 0, -0.4 * k);
        break;
      }
      case 'throw': {
        // Release and follow through.
        const k = Math.min(1, t * 7);
        const back = 1 - k;
        p.add('ArmR1', -1.65 * back - 1.6 * bump(t, 0, 0.5) + 0.3 * k, 0.25 * back, -0.25 * back);
        p.add('ArmR2', -0.2);
        p.add('ArmL1', 0.4 * k, 0, 0.2);
        p.add('Spine1', 0.22 * bump(t, 0, 0.6), 0.45 * back - 0.35 * k);
        break;
      }
      case 'cheer': {
        const pump = Math.abs(Math.sin(t * 9));
        p.add('ArmL1', -2.7 * (0.85 + 0.15 * pump), 0, 0.3);
        p.add('ArmR1', -2.7 * (0.85 + 0.15 * (1 - pump)), 0, -0.3);
        p.add('Neck1', 0.25);
        break;
      }
      case 'down': {
        p.add('Spine1', 0.4);
        p.add('ArmL1', -0.5, 0, 0.8);
        p.add('ArmR1', -0.5, 0, -0.8);
        break;
      }
      default:
        break;
    }
    this.root.rotation.x = this.state === 'down' ? -Math.min(1, t * 3) * 1.4 : 0;
    this.rig.applyPose(p, this.emotePlayer);
  }

  dispose(): void {
    this.disposed = true;
    this.bodyToken += 1;
    this.dresser.dispose();
    this.root.removeFromParent();
  }
}
