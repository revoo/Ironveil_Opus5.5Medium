// Small CPU-drawn canvas layers uploaded as textures each frame (light map, bloom, fog).
// Deterministic and engine-quirk free; sizes are tiny (<= 480x270).
import Phaser from 'phaser';

export class CanvasLayer {
  readonly ctx: CanvasRenderingContext2D;
  readonly image: Phaser.GameObjects.Image;
  private tex: Phaser.Textures.CanvasTexture;

  constructor(scene: Phaser.Scene, key: string, readonly w: number, readonly h: number, readonly scale: number, depth: number, blend: number) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    this.tex = scene.textures.createCanvas(key, w, h)!;
    this.ctx = this.tex.getContext();
    this.image = scene.add.image(0, 0, key).setOrigin(0).setScale(scale).setDepth(depth).setBlendMode(blend);
  }

  place(x: number, y: number): void {
    this.image.setPosition(x, y);
  }

  commit(): void {
    this.tex.refresh();
  }
}

export function rgba(color: number, a: number): string {
  return `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
