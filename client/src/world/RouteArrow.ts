import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
} from 'three';

const vertex = /* glsl */ `
  attribute float along;
  attribute float edge;
  varying float vAlong;
  varying float vEdge;
  void main() {
    vAlong = along;
    vEdge = edge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 color;
  uniform float progress;
  uniform float opacity;
  uniform float time;
  uniform float length;
  varying float vAlong;
  varying float vEdge;
  void main() {
    if (vAlong > progress) discard;
    float e = abs(vEdge);
    float core = 1.0 - smoothstep(0.25, 0.55, e);
    float glow = 1.0 - smoothstep(0.3, 1.0, e);
    float flow = 0.8 + 0.2 * sin(vAlong * length * 0.9 - time * 9.0);
    float head = smoothstep(progress - 0.04, progress, vAlong) * 0.6;
    vec3 c = mix(color, vec3(1.0), core * 0.3 + head);
    float a = clamp(core + glow * 0.45, 0.0, 1.0) * flow * opacity;
    gl_FragColor = vec4(c, a);
  }
`;

const STEP = 0.6;

/**
 * A glowing route drawn on the turf, ending in an arrowhead: where a
 * receiver is about to run. Points are world (x, z) pairs.
 */
export class RouteArrow {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly totalLength: number;

  constructor(points: ReadonlyArray<readonly [number, number]>, color: number, width = 1.25) {
    // Resample the polyline evenly.
    const pts: Array<[number, number]> = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i] as readonly [number, number];
      const b = points[i + 1] as readonly [number, number];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = 0; k < n; k += 1) {
        const t = k / n;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      total += len;
    }
    // Stop the strip short so the arrowhead sits on the tip.
    const headLen = 2.3;
    const last = points[points.length - 1] as readonly [number, number];
    const prev = points[points.length - 2] as readonly [number, number];
    const dl = Math.hypot(last[0] - prev[0], last[1] - prev[1]) || 1;
    const dx = (last[0] - prev[0]) / dl;
    const dz = (last[1] - prev[1]) / dl;
    const base: [number, number] = [last[0] - dx * headLen, last[1] - dz * headLen];
    while (pts.length > 1) {
      const p = pts[pts.length - 1] as [number, number];
      if ((p[0] - base[0]) * dx + (p[1] - base[1]) * dz > -0.05) pts.pop();
      else break;
    }
    pts.push(base);
    this.totalLength = total;

    const positions: number[] = [];
    const along: number[] = [];
    const edge: number[] = [];
    const index: number[] = [];
    let run = 0;
    const y = 0.09;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i] as [number, number];
      const a = pts[Math.max(0, i - 1)] as [number, number];
      const b = pts[Math.min(pts.length - 1, i + 1)] as [number, number];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      if (i > 0) run += Math.hypot(p[0] - (pts[i - 1] as [number, number])[0], p[1] - (pts[i - 1] as [number, number])[1]);
      const nx = -tz * width;
      const nz = tx * width;
      positions.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
      const f = run / total;
      along.push(f, f);
      edge.push(-1, 1);
      if (i > 0) {
        const v = i * 2;
        index.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    }
    // Arrowhead.
    const v0 = positions.length / 3;
    const hw = width * 2.5;
    const fb = run / total;
    positions.push(base[0] - dz * hw, y, base[1] + dx * hw, base[0] + dz * hw, y, base[1] - dx * hw, last[0], y, last[1]);
    along.push(fb, fb, 1);
    edge.push(-0.15, 0.15, 0);
    // A soft halo behind the arrowhead.
    positions.push(base[0] - dz * hw * 1.5, y - 0.005, base[1] + dx * hw * 1.5, base[0] + dz * hw * 1.5, y - 0.005, base[1] - dx * hw * 1.5, last[0] + dx * 0.9, y - 0.005, last[1] + dz * 0.9);
    along.push(fb, fb, 1);
    edge.push(-0.9, 0.9, 0.8);
    index.push(v0, v0 + 1, v0 + 2, v0 + 3, v0 + 4, v0 + 5);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('along', new BufferAttribute(new Float32Array(along), 1));
    geo.setAttribute('edge', new BufferAttribute(new Float32Array(edge), 1));
    geo.setIndex(index);
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        color: { value: new Color(color) },
        progress: { value: 0 },
        opacity: { value: 1 },
        time: { value: 0 },
        length: { value: total },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
  }

  get length(): number {
    return this.totalLength;
  }

  set progress(v: number) {
    (this.material.uniforms['progress'] as { value: number }).value = Math.max(0, Math.min(1.001, v));
  }

  set opacity(v: number) {
    (this.material.uniforms['opacity'] as { value: number }).value = v;
    this.mesh.visible = v > 0.01;
  }

  tick(time: number): void {
    (this.material.uniforms['time'] as { value: number }).value = time;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
