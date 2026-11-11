import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { TeamColors } from '@mctf/shared';
import { jerseyTexture } from '../util/canvas.js';

export type NpcPose =
  | 'idle'
  | 'run'
  | 'stance'
  | 'block'
  | 'rush'
  | 'backpedal'
  | 'reach'
  | 'carry'
  | 'dive'
  | 'down'
  | 'celebrate'
  | 'snap';

/** Character height, matched to the player's own avatar. */
export const NPC_HEIGHT = 2.8;

const SKINS = [0xffd7b0, 0xf1c08f, 0xd79e6c, 0xa86f45, 0x7a4b2c, 0x5a3520];

const materialCache = new Map<number, MeshLambertMaterial>();
const flat = (color: number): MeshLambertMaterial => {
  let m = materialCache.get(color);
  if (!m) {
    m = new MeshLambertMaterial({ color });
    materialCache.set(color, m);
  }
  return m;
};

const GEO = {
  leg: new RoundedBoxGeometry(0.44, 0.62, 0.46, 2, 0.08),
  shin: new RoundedBoxGeometry(0.4, 0.52, 0.42, 2, 0.08),
  shoe: new RoundedBoxGeometry(0.44, 0.18, 0.62, 2, 0.06),
  torso: new BoxGeometry(1.0, 0.95, 0.56),
  pads: new RoundedBoxGeometry(1.38, 0.38, 0.74, 2, 0.14),
  sleeve: new RoundedBoxGeometry(0.4, 0.44, 0.42, 2, 0.1),
  arm: new RoundedBoxGeometry(0.32, 0.54, 0.34, 2, 0.08),
  glove: new RoundedBoxGeometry(0.34, 0.2, 0.36, 2, 0.06),
  helmet: new SphereGeometry(0.47, 18, 14),
  face: new BoxGeometry(0.5, 0.42, 0.2),
  maskBar: new BoxGeometry(0.62, 0.06, 0.06),
  maskPost: new BoxGeometry(0.06, 0.34, 0.06),
  stripe: new BoxGeometry(0.12, 0.08, 0.98),
};

/**
 * A blocky football player in full uniform: helmet with facemask, shoulder
 * pads and a numbered jersey. Built from primitives, animated by rotating
 * its limb pivots.
 */
export class NpcBody {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly foreL = new Group();
  private readonly foreR = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly shinL = new Group();
  private readonly shinR = new Group();
  readonly handR = new Group();

  pose: NpcPose = 'idle';
  /** Run speed for the gait, units/s. */
  speed = 0;
  private phase = Math.random() * 6;
  private time = Math.random() * 10;
  private poseTime = 0;
  private lastPose: NpcPose = 'idle';

  constructor(colors: TeamColors, num: number, name: string, seed: number) {
    const jersey = flat(colors.jersey);
    const trim = flat(colors.trim);
    const pants = flat(colors.pants);
    const helmetM = new MeshLambertMaterial({ color: colors.helmet });
    const skin = flat(SKINS[Math.abs(seed) % SKINS.length] as number);
    const sock = flat(colors.jersey);
    const shoe = flat(0x16161c);
    const mask = flat(0xb8bcc8);
    const front = new MeshLambertMaterial({ map: jerseyTexture(colors.jersey, colors.trim, colors.number, num, '') });
    const back = new MeshLambertMaterial({ map: jerseyTexture(colors.jersey, colors.trim, colors.number, num, name) });
    const torsoMats: Material[] = [jersey, jersey, jersey, jersey, front, back];

    // Legs: pivots at the hips.
    for (const [leg, shin, x] of [[this.legL, this.shinL, 0.25], [this.legR, this.shinR, -0.25]] as const) {
      leg.position.set(x, 1.12, 0);
      const thigh = mesh(GEO.leg, pants);
      thigh.position.y = -0.3;
      shin.position.y = -0.58;
      const lower = mesh(GEO.shin, sock);
      lower.position.y = -0.24;
      const foot = mesh(GEO.shoe, shoe);
      foot.position.set(0, -0.48, 0.08);
      shin.add(lower, foot);
      leg.add(thigh, shin);
      this.body.add(leg);
    }

    // Torso pivots at the waist.
    this.torso.position.y = 1.08;
    const chest = new Mesh(GEO.torso, torsoMats);
    chest.position.y = 0.5;
    chest.castShadow = true;
    const pads = mesh(GEO.pads, jersey);
    pads.position.y = 0.92;
    const padTrim = mesh(new BoxGeometry(1.4, 0.08, 0.76), trim);
    padTrim.position.y = 0.8;
    const belt = mesh(new BoxGeometry(1.02, 0.12, 0.58), pants);
    belt.position.y = 0.02;
    this.torso.add(chest, pads, padTrim, belt);

    // Head: helmet with a stripe and a cage.
    this.head.position.y = 1.08;
    const face = mesh(GEO.face, skin);
    face.position.set(0, 0.32, 0.22);
    const helmet = new Mesh(GEO.helmet, helmetM);
    helmet.scale.set(1, 0.98, 1.08);
    helmet.position.y = 0.42;
    helmet.castShadow = true;
    const stripe = mesh(GEO.stripe, trim);
    stripe.position.set(0, 0.88, 0);
    const bars = new Group();
    for (const y of [0.2, 0.34, 0.48]) {
      const bar = mesh(GEO.maskBar, mask);
      bar.position.set(0, y, 0.5);
      bars.add(bar);
    }
    for (const x of [-0.12, 0.12]) {
      const post = mesh(GEO.maskPost, mask);
      post.position.set(x, 0.34, 0.5);
      bars.add(post);
    }
    this.head.add(face, helmet, stripe, bars);
    this.torso.add(this.head);

    // Arms: pivots at the shoulders.
    for (const [arm, fore, x] of [[this.armL, this.foreL, 0.66], [this.armR, this.foreR, -0.66]] as const) {
      arm.position.set(x, 0.84, 0);
      const sleeve = mesh(GEO.sleeve, jersey);
      sleeve.position.y = -0.16;
      fore.position.y = -0.36;
      const forearm = mesh(GEO.arm, skin);
      forearm.position.y = -0.24;
      const glove = mesh(GEO.glove, flat(0x222230));
      glove.position.y = -0.56;
      fore.add(forearm, glove);
      arm.add(sleeve, fore);
      this.torso.add(arm);
    }
    this.handR.position.set(0, -0.6, 0.15);
    this.foreR.add(this.handR);

    this.body.add(this.torso);
    this.root.add(this.body);
  }

  setPose(pose: NpcPose): void {
    if (pose !== this.pose) this.pose = pose;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.pose !== this.lastPose) {
      this.lastPose = this.pose;
      this.poseTime = 0;
    }
    this.poseTime += dt;
    const s = Math.min(1, this.speed / 14);
    this.phase += dt * (4 + this.speed * 0.75);
    const sin = Math.sin(this.phase);
    const cos = Math.cos(this.phase);

    // Reset.
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const g of [this.armL, this.armR, this.foreL, this.foreR, this.legL, this.legR, this.shinL, this.shinR]) g.rotation.set(0, 0, 0);
    this.armL.rotation.z = 0.12;
    this.armR.rotation.z = -0.12;

    const gait = (amount: number, lean: number): void => {
      this.legL.rotation.x = -sin * 0.95 * amount;
      this.legR.rotation.x = sin * 0.95 * amount;
      this.shinL.rotation.x = Math.max(0, cos) * 1.1 * amount;
      this.shinR.rotation.x = Math.max(0, -cos) * 1.1 * amount;
      this.armL.rotation.x = sin * 0.9 * amount;
      this.armR.rotation.x = -sin * 0.9 * amount;
      this.foreL.rotation.x = -0.9 * amount;
      this.foreR.rotation.x = -0.9 * amount;
      this.torso.rotation.x = lean * amount;
      this.body.position.y = Math.abs(sin) * 0.12 * amount;
    };

    switch (this.pose) {
      case 'idle': {
        const b = Math.sin(this.time * 2) * 0.03;
        this.torso.rotation.x = 0.05 + b;
        this.armL.rotation.z = 0.2;
        this.armR.rotation.z = -0.2;
        if (s > 0.05) gait(s, 0.15);
        break;
      }
      case 'run':
        gait(Math.max(0.35, s), 0.28);
        break;
      case 'carry':
        gait(Math.max(0.35, s), 0.32);
        // Ball tucked under the right arm.
        this.armR.rotation.x = -0.5;
        this.foreR.rotation.x = -1.7;
        this.armR.rotation.z = 0.25;
        break;
      case 'backpedal':
        gait(Math.max(0.3, s) * 0.7, -0.05);
        this.legL.rotation.x *= -1;
        this.legR.rotation.x *= -1;
        this.torso.rotation.x = 0.35;
        break;
      case 'stance': {
        // Three-point stance: low, one hand down.
        this.body.position.y = -0.48;
        this.torso.rotation.x = 1.15;
        this.head.rotation.x = -0.9;
        this.legL.rotation.x = -1.0;
        this.legR.rotation.x = -0.55;
        this.shinL.rotation.x = 1.45;
        this.shinR.rotation.x = 1.05;
        this.armR.rotation.x = -0.35;
        this.armL.rotation.x = 0.4;
        this.foreL.rotation.x = -0.9;
        break;
      }
      case 'snap': {
        this.body.position.y = -0.48;
        this.torso.rotation.x = 1.15;
        this.head.rotation.x = -0.9;
        this.legL.rotation.x = -0.8;
        this.legR.rotation.x = -0.8;
        this.shinL.rotation.x = 1.3;
        this.shinR.rotation.x = 1.3;
        const k = Math.min(1, this.poseTime * 5);
        this.armR.rotation.x = -0.4 + 1.6 * k;
        this.armL.rotation.x = -0.3;
        break;
      }
      case 'block':
      case 'rush': {
        const push = Math.sin(this.time * (this.pose === 'rush' ? 9 : 7)) * 0.12;
        this.body.position.y = -0.18;
        this.torso.rotation.x = 0.55 + push * 0.5;
        this.head.rotation.x = -0.45;
        this.legL.rotation.x = -0.75 + push;
        this.legR.rotation.x = 0.25 - push;
        this.shinL.rotation.x = 0.7;
        this.shinR.rotation.x = 0.35;
        this.armL.rotation.x = -1.35 + push;
        this.armR.rotation.x = -1.35 - push;
        this.foreL.rotation.x = -0.35;
        this.foreR.rotation.x = -0.35;
        if (s > 0.15) gait(s * 0.6, 0.5);
        break;
      }
      case 'reach': {
        if (s > 0.1) gait(s, 0.15);
        this.armL.rotation.x = -2.5;
        this.armR.rotation.x = -2.5;
        this.foreL.rotation.x = -0.2;
        this.foreR.rotation.x = -0.2;
        this.armL.rotation.z = -0.15;
        this.armR.rotation.z = 0.15;
        this.head.rotation.x = -0.35;
        break;
      }
      case 'dive': {
        const k = Math.min(1, this.poseTime * 3.2);
        this.body.rotation.x = 1.4 * k;
        this.body.position.y = 0.32 * k;
        this.armL.rotation.x = -2.8;
        this.armR.rotation.x = -2.8;
        this.legL.rotation.x = 0.3;
        this.legR.rotation.x = 0.1;
        break;
      }
      case 'down': {
        const k = Math.min(1, this.poseTime * 3);
        this.body.rotation.x = -1.45 * k;
        this.body.position.y = 0.3 * k;
        this.armL.rotation.z = 0.8;
        this.armR.rotation.z = -0.8;
        break;
      }
      case 'celebrate': {
        const pump = Math.abs(Math.sin(this.time * 8));
        this.armL.rotation.x = -2.7 - 0.2 * pump;
        this.armR.rotation.x = -2.7 - 0.2 * (1 - pump);
        this.body.position.y = pump * 0.35;
        this.legL.rotation.x = -0.2 * pump;
        this.legR.rotation.x = -0.2 * pump;
        break;
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

const mesh = (geo: BoxGeometry | SphereGeometry, mat: Material): Mesh => {
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  return m;
};
