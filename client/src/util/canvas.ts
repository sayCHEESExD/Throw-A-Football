import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

export const FONT = "'Lilita One', 'Arial Black', system-ui, sans-serif";

export const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Draw into a fresh canvas and wrap it as an sRGB texture. */
export const canvasTexture = (
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  draw(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

/** Centered, outlined text. */
export const outlinedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke: string,
  strokeWidth = size * 0.12,
): void => {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
};

const numberCache = new Map<string, Texture>();

/** A jersey panel: team colour with a big number and a trim stripe. */
export const jerseyTexture = (jersey: number, trim: number, numberColor: number, n: number, name: string): Texture => {
  const key = `${jersey}|${trim}|${numberColor}|${n}|${name}`;
  const cached = numberCache.get(key);
  if (cached) return cached;
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = hex(jersey);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(trim);
    ctx.fillRect(0, h * 0.86, w, h * 0.06);
    if (name) outlinedText(ctx, name.toUpperCase(), w / 2, h * 0.13, 15, hex(numberColor), hex(jersey), 0);
    outlinedText(ctx, String(n), w / 2, h * 0.55, 68, hex(numberColor), hex(trim), 6);
  });
  numberCache.set(key, tex);
  return tex;
};
