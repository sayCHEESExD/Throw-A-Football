import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { clientConfig } from '../config/clientConfig.js';

export type Quality = 'Low' | 'Medium' | 'High' | 'Ultra';

/** The renderer, scene, camera and lights. Nothing game-specific. */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(58, 1, 0.3, 900);
  readonly sun = new DirectionalLight(0xffffff, 2.3);
  readonly hemi = new HemisphereLight(0xcfe8ff, 0x4f7a3a, 1.35);
  private quality: Quality = 'High';
  private readonly onResizeBound = (): void => this.resize();

  constructor(canvas: HTMLCanvasElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.background = new Color(0x7cc4ff);
    this.scene.fog = new Fog(0xa9d8ff, 260, 760);

    this.sun.position.set(-60, 120, -40);
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -110;
    cam.right = 110;
    cam.top = 110;
    cam.bottom = -110;
    cam.near = 10;
    cam.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.setQuality(mobile ? 'Medium' : 'High');
    window.addEventListener('resize', this.onResizeBound);
    this.resize();
  }

  get isLow(): boolean {
    return this.quality === 'Low';
  }

  setQuality(level: string): void {
    const q: Quality = level === 'Low' || level === 'Medium' || level === 'Ultra' ? level : 'High';
    this.quality = q;
    const shadows = q === 'High' || q === 'Ultra';
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(q === 'Ultra' ? 4096 : 2048, q === 'Ultra' ? 4096 : 2048);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    const ratio = q === 'Low' ? 1 : q === 'Medium' ? 1.25 : clientConfig.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones see more field when the vertical FOV opens up.
    this.camera.fov = w < h ? 72 : 58;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
