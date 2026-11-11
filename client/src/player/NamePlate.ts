import { Box3, CanvasTexture, LinearFilter, Mesh, SRGBColorSpace, SkinnedMesh, Sprite, SpriteMaterial, Vector3 } from 'three';
import { visibleName } from '@mctf/shared';

/** World units tall the whole plate is (name, bio and role lines). */
const HEIGHT = 1.7;
/** Canvas pixels per world unit. Enough to stay crisp at close range. */
const PIXELS_PER_UNIT = 48;
/** Widest a plate may get before the text is shrunk to fit it. */
const MAX_WIDTH = 6.4;
/** How far the plate's centre floats above the top of the head. */
const CLEARANCE = 1.15;
/** How often the real top of the character is re-measured (ms). */
const MEASURE_MS = 1000;

const BOX = new Box3();
const PART = new Box3();
const POINT = new Vector3();

export interface PlateText {
  /** The RP name if set, else the display name. */
  readonly name: string;
  readonly bio: string;
  readonly role: string;
  readonly roleColor: string;
  readonly vip: boolean;
  /** A status line in red (Cuffed, In Jail) replaces the role. */
  readonly status: string;
  /** Wanted stars (0-3), drawn in gold over the name. */
  readonly wanted?: number;
}

/**
 * THE NAME OVER A PLAYER'S HEAD, the Redmond way: a small white name, the
 * RP bio under it in soft grey, and the role in its colour (a gold VIP tag
 * beside it). A SPRITE, so it faces the camera from every angle; redrawn only
 * when its text changes. It hangs off the character, so it is counter-scaled
 * by the player's age: a baby's name is as readable as a grown-up's.
 */
export class NamePlate {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private painted = '\u0000';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(MAX_WIDTH * PIXELS_PER_UNIT);
    this.canvas.height = Math.round(HEIGHT * PIXELS_PER_UNIT);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.material = new SpriteMaterial({ map: this.texture, transparent: true, fog: false, depthWrite: false });
    this.sprite = new Sprite(this.material);
    this.sprite.scale.set(MAX_WIDTH, HEIGHT, 1);
    this.sprite.visible = false;
  }

  /**
   * @param height the character's UNSCALED height (the plate sits in its frame)
   * @param scale  the character's age scale, which the plate undoes
   */
  set(text: PlateText, height: number, scale = 1): void {
    const signature = JSON.stringify(text);
    if (signature !== this.painted) {
      this.painted = signature;
      this.paint(text);
    }
    this.k = 1 / Math.max(0.2, scale);
    this.baseHeight = height;
    this.sprite.scale.set(MAX_WIDTH * this.k * this.near, HEIGHT * this.k * this.near, 1);
    this.place();
    this.sprite.visible = true;
  }

  private k = 1;
  private near = 1;
  /** The nominal head height, and the measured top of the body + headwear (0 = not measured yet). */
  private baseHeight = 3.4;
  private measuredTop = 0;
  private measureAt = 0;

  /**
   * Stay a small tag when the camera is close (a sprite would fill the screen),
   * and keep clear of the head: every second the character's real top is
   * measured, so a tall avatar, a big head or a helmet never swallows the name.
   */
  fit(cameraDistance: number): void {
    const now = performance.now();
    if (now >= this.measureAt) {
      this.measureAt = now + MEASURE_MS;
      this.measure();
    }
    const near = Math.min(1, Math.max(0.35, cameraDistance / 16));
    if (Math.abs(near - this.near) < 0.02) return;
    this.near = near;
    this.sprite.scale.set(MAX_WIDTH * this.k * near, HEIGHT * this.k * near, 1);
  }

  private place(): void {
    this.sprite.position.set(0, Math.max(this.baseHeight, this.measuredTop) + CLEARANCE * this.k, 0);
  }

  /**
   * The top of everything worn on the body, in the plate's parent frame:
   * skinned parts are measured POSED (the head is sized through the neck bone,
   * so a bind-pose box would miss a big head), hats, hair and masks by their
   * own boxes. Plates and other sprites are skipped. Never throws.
   */
  private measure(): void {
    const parent = this.sprite.parent;
    if (!parent) return;
    try {
      parent.updateWorldMatrix(true, true);
      BOX.makeEmpty();
      parent.traverseVisible((object) => {
        if (object instanceof Sprite || !(object instanceof Mesh)) return;
        if (object instanceof SkinnedMesh) {
          object.computeBoundingBox();
          if (!object.boundingBox) return;
          PART.copy(object.boundingBox).applyMatrix4(object.matrixWorld);
        } else {
          const geometry = object.geometry;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          if (!geometry.boundingBox) return;
          PART.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
        }
        BOX.union(PART);
      });
      if (BOX.isEmpty()) return;
      parent.getWorldPosition(POINT);
      POINT.y = BOX.max.y;
      parent.worldToLocal(POINT);
      if (!Number.isFinite(POINT.y)) return;
      this.measuredTop = POINT.y;
      this.place();
    } catch {
      /* a plate that cannot measure keeps its nominal height */
    }
  }

  private paint(text: PlateText): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    const name = visibleName(text.name);
    const lines: { text: string; color: string; size: number; weight: number }[] = [];
    if (text.wanted) lines.push({ text: `${'★'.repeat(text.wanted)} WANTED`, color: '#ffc531', size: 0.18, weight: 900 });
    lines.push({ text: name, color: '#ffffff', size: 0.34, weight: 800 });
    if (text.bio) lines.push({ text: text.bio, color: '#d9e4f2', size: 0.22, weight: 700 });
    if (text.status) lines.push({ text: text.status.toUpperCase(), color: '#ff6b6b', size: 0.22, weight: 900 });
    else if (text.role) lines.push({ text: text.role, color: text.roleColor, size: 0.22, weight: 900 });
    const total = lines.reduce((sum, l) => sum + l.size, 0);
    let y = Math.max(0, height - total * height - height * 0.04);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const line of lines) {
      let size = line.size * height;
      for (let pass = 0; pass < 4; pass += 1) {
        ctx.font = `${line.weight} ${size}px "Fredoka", "Nunito", "Segoe UI", system-ui, sans-serif`;
        const drawn = ctx.measureText(line.text).width + (line === lines[lines.length - 1] && text.vip ? size * 2.2 : 0);
        if (drawn <= width * 0.94) break;
        size *= (width * 0.94) / drawn;
      }
      const vipHere = text.vip && line === lines[lines.length - 1];
      const tagW = vipHere ? size * 2 : 0;
      const textW = ctx.measureText(line.text).width;
      const x = width / 2 - tagW / 2;
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = 'rgba(10, 16, 28, 0.85)';
      ctx.strokeText(line.text, x, y);
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, x, y);
      if (vipHere) {
        const tx = x + textW / 2 + size * 0.25;
        ctx.fillStyle = '#ffc531';
        ctx.beginPath();
        ctx.roundRect(tx, y, size * 1.75, size * 0.95, size * 0.3);
        ctx.fill();
        ctx.fillStyle = '#5a3a00';
        ctx.font = `900 ${size * 0.7}px "Fredoka", system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('VIP', tx + size * 0.28, y + size * 0.14);
        ctx.textAlign = 'center';
      }
      y += line.size * height;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.sprite.removeFromParent();
  }
}
