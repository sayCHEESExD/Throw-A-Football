import { Vector3, type PerspectiveCamera } from 'three';

const v = new Vector3();

export interface Tag {
  el: HTMLDivElement;
  world: Vector3;
  visible: boolean;
  text: string;
}

/** Name tags and floating text drawn over the 3D view. */
export class Labels {
  private readonly layer: HTMLDivElement;
  private readonly tags = new Set<Tag>();

  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'labels';
    document.body.appendChild(this.layer);
  }

  tag(): Tag {
    const el = document.createElement('div');
    el.className = 'tag t';
    this.layer.appendChild(el);
    const t: Tag = { el, world: new Vector3(), visible: true, text: '' };
    this.tags.add(t);
    return t;
  }

  set(t: Tag, markup: string): void {
    if (t.text === markup) return;
    t.text = markup;
    t.el.innerHTML = markup;
  }

  remove(t: Tag): void {
    t.el.remove();
    this.tags.delete(t);
  }

  /** Text that rises and fades over a world point. */
  float(world: Vector3, markup: string, camera: PerspectiveCamera, color = '#ffffff'): void {
    v.copy(world).project(camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'float t';
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    el.style.color = color;
    el.innerHTML = markup;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  update(camera: PerspectiveCamera, maxDistance = 90): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const t of this.tags) {
      if (!t.visible) {
        if (t.el.style.display !== 'none') t.el.style.display = 'none';
        continue;
      }
      const dist = camera.position.distanceTo(t.world);
      v.copy(t.world).project(camera);
      if (v.z > 1 || dist > maxDistance || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        if (t.el.style.display !== 'none') t.el.style.display = 'none';
        continue;
      }
      if (t.el.style.display === 'none') t.el.style.display = '';
      const scale = Math.max(0.55, Math.min(1.15, 26 / dist));
      t.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) scale(${scale.toFixed(2)}) translate(-50%, -100%)`;
    }
  }
}
