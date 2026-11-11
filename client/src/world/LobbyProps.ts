import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Scene,
} from 'three';
import { FIELD_HALF_WIDTH, PACKS, type PackId } from '@mctf/shared';

export interface BoardLine {
  name: string;
  value: string;
  me: boolean;
}

interface Stand {
  pack: PackId;
  x: number;
  z: number;
  box: Mesh;
  pad: Mesh;
  armed: boolean;
}

const STAND_PACKS: readonly PackId[] = ['receiver', 'lineman', 'backfield', 'defense', 'epic'];
const STAND_LABEL: Record<string, string> = {
  receiver: 'RECEIVER PACKS',
  lineman: 'LINEMAN PACKS',
  backfield: 'BACKFIELD PACKS',
  defense: 'DEFENSE PACKS',
  epic: 'EPIC PACKS',
};
const PAD_RADIUS = 2.2;

const sign = (text: string, color: string, w = 512, h = 128): CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#141a3d';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeRect(5, 5, w - 10, h - 10);
  g.font = `bold ${Math.floor(h * 0.42)}px "Lilita One", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#0b0f22';
  g.strokeText(text, w / 2, h / 2 + 4);
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** Pack stands and leaderboard boards around the practice field. */
export class LobbyProps {
  readonly root = new Group();
  private readonly stands: Stand[] = [];
  private readonly boards: Array<{ title: string; canvas: HTMLCanvasElement; tex: CanvasTexture }> = [];
  private time = 0;

  constructor(scene: Scene) {
    // Pack stands along the left sideline, facing the field.
    const x = -(FIELD_HALF_WIDTH + 7);
    STAND_PACKS.forEach((pack, i) => {
      const z = -30 + i * 11;
      const def = PACKS[pack];
      const g = new Group();
      g.position.set(x, 0, z);
      g.rotation.y = Math.PI / 2;
      const counter = new Mesh(new BoxGeometry(5, 1.4, 2), new MeshStandardMaterial({ color: 0x1d2552, roughness: 0.6 }));
      counter.position.y = 0.7;
      counter.castShadow = true;
      const top = new Mesh(new BoxGeometry(5.2, 0.2, 2.2), new MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35 }));
      top.position.y = 1.5;
      const box = new Mesh(new BoxGeometry(1.4, 1.8, 0.4), new MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.3 }));
      box.position.y = 3;
      const post = new Mesh(new BoxGeometry(0.25, 4.5, 0.25), new MeshStandardMaterial({ color: 0x2b335f }));
      post.position.set(0, 2.25, -0.9);
      const board = new Mesh(new PlaneGeometry(6, 1.5), new MeshBasicMaterial({ map: sign(STAND_LABEL[pack] ?? def.name, def.color) }));
      board.position.set(0, 5.1, -0.85);
      const pad = new Mesh(
        new CircleGeometry(PAD_RADIUS, 32),
        new MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, 0.06, 2.8);
      g.add(counter, top, box, post, board, pad);
      this.root.add(g);
      // Pad position in world space (the group is turned to face +x).
      this.stands.push({ pack, x: x + 2.8, z, box, pad, armed: true });
    });

    // Leaderboards on the right sideline.
    const bx = FIELD_HALF_WIDTH + 9;
    ['TOUCHDOWNS', 'HIGHEST STAGE'].forEach((title, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 640;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const panel = new Mesh(new PlaneGeometry(7, 8.75), new MeshBasicMaterial({ map: tex }));
      panel.position.set(bx, 5.6, -24 + i * 12);
      panel.rotation.y = -Math.PI / 2;
      const frame = new Mesh(new BoxGeometry(0.3, 9.3, 7.6), new MeshStandardMaterial({ color: 0xff2d9b, emissive: 0xff2d9b, emissiveIntensity: 0.4 }));
      frame.position.set(bx + 0.2, 5.6, -24 + i * 12);
      const leg = new Mesh(new BoxGeometry(0.4, 1.4, 0.4), new MeshStandardMaterial({ color: 0x2b335f }));
      leg.position.set(bx + 0.2, 0.7, -24 + i * 12);
      this.root.add(frame, panel, leg);
      this.boards.push({ title, canvas, tex });
    });
    scene.add(this.root);
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  /** Spin the pack boxes; returns a pack when the player steps onto a stand's pad. */
  update(dt: number, px: number, pz: number): PackId | null {
    this.time += dt;
    let hit: PackId | null = null;
    for (const s of this.stands) {
      s.box.rotation.y = this.time * 1.2;
      s.box.position.y = 3 + Math.sin(this.time * 2 + s.z) * 0.15;
      const on = Math.hypot(px - s.x, pz - s.z) < PAD_RADIUS;
      (s.pad.material as MeshBasicMaterial).opacity = on ? 0.8 : 0.35 + Math.sin(this.time * 3 + s.z) * 0.1;
      if (on && s.armed) {
        s.armed = false;
        hit = s.pack;
      } else if (!on && Math.hypot(px - s.x, pz - s.z) > PAD_RADIUS + 1) {
        s.armed = true;
      }
    }
    return hit;
  }

  /** Redraw a board (0 = touchdowns, 1 = highest stage). */
  draw(index: number, lines: readonly BoardLine[]): void {
    const b = this.boards[index];
    if (!b) return;
    const g = b.canvas.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#10163a';
    g.fillRect(0, 0, 512, 640);
    g.fillStyle = '#ff2d9b';
    g.fillRect(0, 0, 512, 92);
    g.font = 'bold 50px "Lilita One", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#0b0f22';
    g.strokeText(b.title, 256, 48);
    g.fillStyle = '#ffffff';
    g.fillText(b.title, 256, 48);
    g.font = 'bold 34px "Lilita One", "Arial Black", sans-serif';
    lines.slice(0, 10).forEach((l, i) => {
      const y = 132 + i * 50;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
      g.fillRect(16, y - 22, 480, 44);
      g.textAlign = 'left';
      g.fillStyle = i === 0 ? '#ffcf3a' : i === 1 ? '#dfe6ff' : i === 2 ? '#ff9d5c' : '#ffffff';
      g.fillText(`#${i + 1}`, 28, y + 2);
      g.fillStyle = l.me ? '#7dffb0' : '#ffffff';
      g.fillText(l.name.slice(0, 14), 104, y + 2);
      g.textAlign = 'right';
      g.fillStyle = '#ffcf3a';
      g.fillText(l.value, 484, y + 2);
    });
    b.tex.needsUpdate = true;
  }
}
