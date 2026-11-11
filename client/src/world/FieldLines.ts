import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Scene,
  type Texture,
} from 'three';
import { END_ZONE_YARDS, FIELD_HALF_WIDTH, YARD, yardToZ } from '@mctf/shared';
import { canvasTexture, outlinedText } from '../util/canvas.js';

const LOS_COLOR = 0x2fb6ff;
const GAIN_COLOR = 0xffe23a;

const badgeCache = new Map<string, Texture>();
const badge = (text: string, color: string): Texture => {
  const key = `${text}|${color}`;
  let t = badgeCache.get(key);
  if (!t) {
    t = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(6, 6, w - 12, h - 12, 12);
      ctx.fill();
      ctx.stroke();
      outlinedText(ctx, text, w / 2, h / 2 + 2, 38, '#1a1a1a', '#1a1a1a', 0);
    });
    badgeCache.set(key, t);
  }
  return t;
};

/** A glowing line across the field, with marker posts on both sidelines. */
class GlowLine {
  readonly root = new Group();
  private readonly badges: Sprite[] = [];

  constructor(color: number, withBadge: boolean) {
    const width = FIELD_HALF_WIDTH * 2;
    const core = new Mesh(new BoxGeometry(width, 0.1, 0.42), new MeshBasicMaterial({ color: 0xffffff }));
    core.position.y = 0.08;
    const glowMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
    const glow = new Mesh(new PlaneGeometry(width, 1.5), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.11;
    const halo = new Mesh(new PlaneGeometry(width, 3.4), new MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.1;
    const tint = new MeshBasicMaterial({ color });
    core.material = new MeshBasicMaterial({ color: 0xffffff });
    this.root.add(halo, glow, core);
    for (const sx of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.09, 0.09, 2.6, 8), new MeshBasicMaterial({ color: 0xdddddd }));
      post.position.set(sx * (FIELD_HALF_WIDTH + 2.2), 1.3, 0);
      post.rotation.z = sx * 0.35;
      const orb = new Mesh(new SphereGeometry(0.42, 12, 10), tint);
      orb.position.set(sx * (FIELD_HALF_WIDTH + 2.65), 2.55, 0);
      const orbGlow = new Mesh(new SphereGeometry(0.9, 12, 10), new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }));
      orbGlow.position.copy(orb.position);
      this.root.add(post, orb, orbGlow);
      if (withBadge) {
        const s = new Sprite(new SpriteMaterial({ map: badge('1', '#ffe23a'), depthTest: false }));
        s.scale.set(2.2, 2.2, 1);
        s.position.set(sx * (FIELD_HALF_WIDTH + 2.65), 4.6, 0);
        s.renderOrder = 5;
        this.badges.push(s);
        this.root.add(s);
      }
    }
  }

  setBadge(text: string): void {
    for (const s of this.badges) {
      s.material.map = badge(text, '#ffe23a');
      s.material.needsUpdate = true;
    }
  }
}

/**
 * Line of scrimmage (blue), line to gain (yellow, with the down on its
 * posts) and, goal to go, the end zone lit up instead.
 */
export class FieldLines {
  readonly root = new Group();
  private readonly los = new GlowLine(LOS_COLOR, false);
  private readonly gain = new GlowLine(GAIN_COLOR, true);
  private readonly endZone: Mesh;
  private time = 0;

  constructor(scene: Scene) {
    this.endZone = new Mesh(
      new PlaneGeometry(FIELD_HALF_WIDTH * 2, END_ZONE_YARDS * YARD),
      new MeshBasicMaterial({ color: GAIN_COLOR, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }),
    );
    this.endZone.rotation.x = -Math.PI / 2;
    this.endZone.position.set(0, 0.12, yardToZ(100 + END_ZONE_YARDS / 2));
    this.root.add(this.los.root, this.gain.root, this.endZone);
    this.root.visible = false;
    scene.add(this.root);
  }

  show(yardLine: number, toGo: number, down: number): void {
    this.root.visible = true;
    this.los.root.position.z = yardToZ(yardLine);
    const goal = yardLine + toGo >= 100;
    this.gain.root.visible = !goal;
    this.endZone.visible = goal;
    this.gain.root.position.z = yardToZ(yardLine + toGo);
    this.gain.setBadge(String(down));
  }

  hide(): void {
    this.root.visible = false;
  }

  update(dt: number): void {
    this.time += dt;
    const m = this.endZone.material as MeshBasicMaterial;
    m.opacity = 0.35 + Math.sin(this.time * 3) * 0.1;
  }
}
