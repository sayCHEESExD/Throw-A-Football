import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import {
  END_ZONE_YARDS,
  FIELD_HALF_LENGTH,
  FIELD_HALF_WIDTH,
  HASH_YARDS,
  YARD,
  type TeamDef,
} from '@mctf/shared';
import { canvasTexture, hex, outlinedText } from '../util/canvas.js';

const GOAL_Z = 50 * YARD;
const APRON_X = FIELD_HALF_WIDTH + 14;
const APRON_Z = FIELD_HALF_LENGTH + 16;

/**
 * The stadium and its field. One instance lives for the whole session; a
 * game re-themes it for the opponent instead of building another.
 */
export class Stadium {
  readonly root = new Group();
  private readonly accent = new MeshLambertMaterial({ color: 0xf2259a });
  private readonly accentGlow = new MeshBasicMaterial({ color: 0xf2259a });
  private readonly fieldMaterial: MeshLambertMaterial;
  private fieldTexture: CanvasTexture | null = null;
  private readonly scoreboard: Mesh[] = [];

  constructor(scene: Scene, lowDetail: boolean) {
    this.fieldMaterial = new MeshLambertMaterial({ color: 0xffffff });
    this.buildGround();
    this.buildMarkings();
    this.buildGoalPosts();
    this.buildStands(lowDetail);
    this.buildLights();
    scene.add(this.root);
    scene.background = skyTexture();
  }

  /** Paint the end zones and the stadium trim for a game. */
  setTheme(home: TeamDef, away: TeamDef | null): void {
    const accent = away ? away.stadium : home.stadium;
    this.accent.color.setHex(accent);
    this.accentGlow.color.setHex(accent);
    this.fieldTexture?.dispose();
    this.fieldTexture = fieldTexture(home, away);
    this.fieldMaterial.map = this.fieldTexture;
    this.fieldMaterial.needsUpdate = true;
    const board = boardTexture(home, away);
    for (const mesh of this.scoreboard) {
      const mat = mesh.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = board;
      mat.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ ground

  private buildGround(): void {
    const apron = new Mesh(new PlaneGeometry(APRON_X * 2 + 30, APRON_Z * 2 + 30), new MeshLambertMaterial({ color: 0x3fae38 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    this.root.add(apron);

    const field = new Mesh(new PlaneGeometry(FIELD_HALF_WIDTH * 2, FIELD_HALF_LENGTH * 2), this.fieldMaterial);
    field.rotation.x = -Math.PI / 2;
    field.receiveShadow = true;
    this.root.add(field);

    // A dark track band where the stands meet the apron.
    const track = new MeshLambertMaterial({ color: 0x2b3350 });
    for (const sx of [-1, 1]) {
      const band = new Mesh(new BoxGeometry(4, 0.2, APRON_Z * 2 + 8), track);
      band.position.set(sx * (APRON_X + 2), 0.05, 0);
      band.receiveShadow = true;
      this.root.add(band);
    }
    for (const sz of [-1, 1]) {
      const band = new Mesh(new BoxGeometry(APRON_X * 2 + 8, 0.2, 4), track);
      band.position.set(0, 0.05, sz * (APRON_Z + 2));
      band.receiveShadow = true;
      this.root.add(band);
    }
  }

  private buildMarkings(): void {
    const white = new MeshLambertMaterial({ color: 0xffffff });
    const lines = new Group();
    const lineGeo = new BoxGeometry(FIELD_HALF_WIDTH * 2, 0.07, 0.22);
    // Yard lines every 5 yards, goal lines included.
    for (let y = 0; y <= 100; y += 5) {
      const m = new Mesh(lineGeo, white);
      m.position.set(0, 0.035, (y - 50) * YARD);
      m.receiveShadow = true;
      lines.add(m);
    }
    // Boundaries.
    for (const sx of [-1, 1]) {
      const side = new Mesh(new BoxGeometry(0.9, 0.08, FIELD_HALF_LENGTH * 2 + 0.9), white);
      side.position.set(sx * (FIELD_HALF_WIDTH + 0.45), 0.04, 0);
      lines.add(side);
    }
    for (const sz of [-1, 1]) {
      const end = new Mesh(new BoxGeometry(FIELD_HALF_WIDTH * 2 + 1.8, 0.08, 0.9), white);
      end.position.set(0, 0.04, sz * (FIELD_HALF_LENGTH + 0.45));
      lines.add(end);
    }
    this.root.add(lines);

    // Chunky hash blocks, the field's signature look: one per yard on the
    // hashes and along both sidelines.
    const blockGeo = new BoxGeometry(1.5, 0.22, 0.32);
    const xs = [-HASH_YARDS * YARD, HASH_YARDS * YARD, -FIELD_HALF_WIDTH + 1.6, FIELD_HALF_WIDTH - 1.6];
    const count = 99 * xs.length;
    const blocks = new InstancedMesh(blockGeo, white, count);
    const m4 = new Matrix4();
    let i = 0;
    for (let y = 1; y < 100; y += 1) {
      if (y % 5 === 0) continue;
      for (const x of xs) {
        m4.makeTranslation(x, 0.11, (y - 50) * YARD);
        blocks.setMatrixAt(i++, m4);
      }
    }
    blocks.count = i;
    blocks.receiveShadow = true;
    blocks.castShadow = true;
    this.root.add(blocks);

    // Painted numbers every 10 yards.
    for (let y = 10; y <= 90; y += 10) {
      const label = String(y <= 50 ? y : 100 - y);
      const tex = canvasTexture(128, 96, (ctx, w, h) => outlinedText(ctx, label, w / 2, h / 2 + 4, 88, '#ffffff', '#ffffff', 0));
      const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      for (const sx of [-1, 1]) {
        const plane = new Mesh(new PlaneGeometry(4.2, 3.1), mat);
        plane.rotation.x = -Math.PI / 2;
        plane.rotation.z = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
        plane.position.set(sx * (FIELD_HALF_WIDTH - 6.5), 0.06, (y - 50) * YARD);
        this.root.add(plane);
      }
    }

    // Pylons at the four goal-line corners.
    const pylon = new MeshLambertMaterial({ color: 0xff7a1a });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const back of [0, END_ZONE_YARDS * YARD]) {
          const p = new Mesh(new BoxGeometry(0.35, 1, 0.35), pylon);
          p.position.set(sx * (FIELD_HALF_WIDTH + 0.3), 0.5, sz * (GOAL_Z + back));
          p.castShadow = true;
          this.root.add(p);
        }
      }
    }
  }

  private buildGoalPosts(): void {
    const yellow = new MeshStandardMaterial({ color: 0xffd52e, roughness: 0.45, metalness: 0.1, emissive: 0x332600 });
    const pad = new MeshLambertMaterial({ color: 0xd62b2b });
    for (const sz of [-1, 1]) {
      const g = new Group();
      const z = sz * (GOAL_Z + END_ZONE_YARDS * YARD + 1);
      const base = new Mesh(new CylinderGeometry(0.35, 0.35, 5.2, 10), yellow);
      base.position.y = 2.6;
      const padding = new Mesh(new BoxGeometry(1.1, 2.6, 1.1), pad);
      padding.position.y = 1.3;
      const neck = new Mesh(new BoxGeometry(0.45, 0.45, 2.4), yellow);
      neck.position.set(0, 5.2, -sz * 1.1);
      const bar = new Mesh(new CylinderGeometry(0.22, 0.22, 8.6, 10), yellow);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 5.2, -sz * 2.3);
      g.add(base, padding, neck, bar);
      for (const sx of [-1, 1]) {
        const up = new Mesh(new CylinderGeometry(0.2, 0.2, 9, 10), yellow);
        up.position.set(sx * 4.3, 9.7, -sz * 2.3);
        g.add(up);
      }
      g.position.z = z;
      g.traverse((c) => {
        if ((c as Mesh).isMesh) (c as Mesh).castShadow = true;
      });
      this.root.add(g);
    }
  }

  // ------------------------------------------------------------ stands

  private buildStands(lowDetail: boolean): void {
    const concrete = new MeshLambertMaterial({ color: 0xc8ccd8 });
    const seats = new MeshLambertMaterial({ color: 0x2c3c78 });
    const dark = new MeshLambertMaterial({ color: 0x1b2340 });
    const rows = 11;
    const step = 2.1;
    const rise = 1.35;
    const crowdGeo = new BoxGeometry(0.95, 1.5, 0.8);
    const crowdMat = new MeshLambertMaterial({ color: 0xffffff });
    const spots: Array<{ x: number; y: number; z: number; rot: number }> = [];

    const side = (length: number, inner: number, axis: 'x' | 'z', sign: number): void => {
      for (let r = 0; r < rows; r += 1) {
        const out = inner + r * step;
        const h = 1.6 + r * rise;
        const tier = new Mesh(new BoxGeometry(axis === 'x' ? step : length + r * step * 2, h, axis === 'x' ? length + r * step * 2 : step), r % 2 ? seats : concrete);
        if (axis === 'x') tier.position.set(sign * (out + step / 2), h / 2, 0);
        else tier.position.set(0, h / 2, sign * (out + step / 2));
        tier.receiveShadow = true;
        this.root.add(tier);
        const n = Math.floor((length + r * step * 2 - 4) / 1.35);
        for (let k = 0; k < n; k += 1) {
          if (Math.random() < (lowDetail ? 0.55 : 0.18)) continue;
          const along = -((length + r * step * 2 - 4) / 2) + k * 1.35 + (Math.random() - 0.5) * 0.2;
          const pos = out + step * 0.55;
          spots.push(
            axis === 'x'
              ? { x: sign * pos, y: h + 0.75, z: along, rot: sign > 0 ? -Math.PI / 2 : Math.PI / 2 }
              : { x: along, y: h + 0.75, z: sign * pos, rot: sign > 0 ? Math.PI : 0 },
          );
        }
      }
      // Back wall with the team-coloured band and an upper overhang.
      const outer = inner + rows * step;
      const wallH = 1.6 + rows * rise + 7;
      const len = length + rows * step * 2 + 2;
      const wall = new Mesh(new BoxGeometry(axis === 'x' ? 2 : len, wallH, axis === 'x' ? len : 2), dark);
      const band = new Mesh(new BoxGeometry(axis === 'x' ? 2.2 : len, 2.2, axis === 'x' ? len : 2.2), this.accentGlow);
      const roof = new Mesh(new BoxGeometry(axis === 'x' ? 16 : len, 1.2, axis === 'x' ? len : 16), concrete);
      if (axis === 'x') {
        wall.position.set(sign * (outer + 1), wallH / 2, 0);
        band.position.set(sign * (outer + 0.9), wallH - 4, 0);
        roof.position.set(sign * (outer - 5), wallH, 0);
      } else {
        wall.position.set(0, wallH / 2, sign * (outer + 1));
        band.position.set(0, wallH - 4, sign * (outer + 0.9));
        roof.position.set(0, wallH, sign * (outer - 5));
      }
      roof.castShadow = true;
      this.root.add(wall, band, roof);
      // A lit rail along the front of the stands.
      const rail = new Mesh(new BoxGeometry(axis === 'x' ? 0.4 : length, 0.5, axis === 'x' ? length : 0.4), this.accentGlow);
      if (axis === 'x') rail.position.set(sign * (inner - 0.2), 1.85, 0);
      else rail.position.set(0, 1.85, sign * (inner - 0.2));
      this.root.add(rail);
    };

    const innerX = APRON_X + 4;
    const innerZ = APRON_Z + 4;
    side(innerZ * 2, innerX, 'x', 1);
    side(innerZ * 2, innerX, 'x', -1);
    side(innerX * 2, innerZ, 'z', 1);
    side(innerX * 2, innerZ, 'z', -1);

    const crowd = new InstancedMesh(crowdGeo, crowdMat, spots.length);
    const palette = [0xf2259a, 0xffffff, 0x2a2f4f, 0xffc93c, 0x39c6ff, 0xff6b6b, 0x8ee05a, 0xf2259a, 0x1d1530];
    const m4 = new Matrix4();
    const color = new Color();
    spots.forEach((s, i) => {
      m4.makeRotationY(s.rot);
      m4.setPosition(s.x, s.y, s.z);
      crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i, color.setHex(palette[Math.floor(Math.random() * palette.length)] as number));
    });
    this.root.add(crowd);

    // Scoreboards over both end zones.
    for (const sz of [-1, 1]) {
      const frame = new Mesh(new BoxGeometry(34, 13, 1.5), dark);
      const y = 1.6 + rows * rise + 13;
      frame.position.set(0, y, sz * (innerZ + rows * step + 0.5));
      const screen = new Mesh(new PlaneGeometry(31, 10.5), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }));
      screen.position.set(0, y, sz * (innerZ + rows * step - 0.4));
      screen.rotation.y = sz > 0 ? Math.PI : 0;
      this.scoreboard.push(screen);
      this.root.add(frame, screen);
    }
  }

  private buildLights(): void {
    const pole = new MeshLambertMaterial({ color: 0x9aa3b8 });
    const lamp = new MeshBasicMaterial({ color: 0xfdfcf0 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const g = new Group();
        const p = new Mesh(new CylinderGeometry(0.8, 1.1, 44, 8), pole);
        p.position.y = 22;
        const panel = new Mesh(new BoxGeometry(10, 6, 1), pole);
        panel.position.y = 46;
        const face = new Mesh(new PlaneGeometry(9, 5), lamp);
        face.position.set(0, 46, 0.55);
        g.add(p, panel, face);
        g.position.set(sx * (APRON_X + 32), 0, sz * (APRON_Z + 30));
        g.lookAt(0, 0, 0);
        this.root.add(g);
      }
    }
  }
}

// ------------------------------------------------------------ textures

const fieldTexture = (home: TeamDef, away: TeamDef | null): CanvasTexture => {
  // 1 px = 1/6 yard across, the canvas covers the whole field incl. end zones.
  const tex = canvasTexture(320, 720, (ctx, w, h) => {
    const yardPx = h / 120;
    for (let y = 0; y < 100; y += 5) {
      ctx.fillStyle = (y / 5) % 2 ? '#46c23a' : '#3db334';
      // The canvas top is world -Z: your own end zone (yard -10).
      ctx.fillRect(0, (10 + y) * yardPx, w, 5 * yardPx);
    }
    // Studs, for the toy-brick look.
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let yy = 0; yy < h; yy += 8) for (let xx = (yy / 8) % 2 ? 4 : 0; xx < w; xx += 8) ctx.fillRect(xx, yy, 3, 3);
    const zone = (team: TeamDef, top: boolean): void => {
      const y0 = top ? 0 : h - 10 * yardPx;
      ctx.fillStyle = hex(team.colors.jersey);
      ctx.fillRect(0, y0, w, 10 * yardPx);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let xx = 0; xx < w; xx += 16) ctx.fillRect(xx, y0, 8, 10 * yardPx);
      ctx.save();
      ctx.translate(w / 2, y0 + 5 * yardPx);
      if (top) ctx.rotate(Math.PI);
      outlinedText(ctx, team.name.toUpperCase(), 0, 0, 34, hex(team.colors.trim), hex(team.colors.pants), 5);
      ctx.restore();
    };
    zone(home, true);
    zone(away ?? home, false);
  });
  return tex;
};

const boardTexture = (home: TeamDef, away: TeamDef | null): CanvasTexture =>
  canvasTexture(512, 172, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16204a');
    g.addColorStop(1, '#0a0f26');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (away) {
      outlinedText(ctx, home.name.toUpperCase(), w * 0.27, h * 0.4, 34, hex(home.colors.jersey), '#ffffff', 3);
      outlinedText(ctx, 'VS', w / 2, h * 0.42, 40, '#ffd52e', '#000000', 4);
      outlinedText(ctx, away.name.toUpperCase(), w * 0.73, h * 0.4, 34, hex(away.colors.jersey), '#ffffff', 3);
      outlinedText(ctx, 'GAME DAY', w / 2, h * 0.78, 30, '#ffffff', '#000000', 0);
    } else {
      outlinedText(ctx, 'THROW FOOTBALL', w / 2, h * 0.38, 54, '#ffffff', hex(home.colors.jersey), 8);
      outlinedText(ctx, 'PRACTICE FIELD', w / 2, h * 0.78, 30, '#ffd52e', '#000000', 0);
    }
  });

const skyTexture = (): CanvasTexture =>
  canvasTexture(2, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3d8ff0');
    g.addColorStop(0.55, '#86c8ff');
    g.addColorStop(1, '#d8f0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
