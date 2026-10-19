import { encodeGrayscale16PNG } from "./pngEncoder";

/**
 * 16 位灰度 ↔ Canvas 的编码约定：
 *
 * HTMLCanvasElement 只支持 8 位/通道 RGBA，因此 16 位灰度值按
 * 「高字节 → R 通道、低字节 → G 通道」拆分存储（B=0, A=255）。
 * 导出时再重组为 Uint16Array 编码为真正的 16 位 PNG。
 */

function get2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 canvas 2D 上下文");
  return ctx;
}

/**
 * 将 16 位灰度数组写入 canvas（高字节 → R，低字节 → G）。
 *
 * @param canvas - 目标 canvas（宽高须与 width/height 一致）
 * @param values - 灰度值 0-65535，长度 width × height
 */
export function writeGrayscale16ToCanvas(
  canvas: HTMLCanvasElement,
  values: Uint16Array,
  width: number,
  height: number
): void {
  const ctx = get2DContext(canvas);
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = values[i];
    image.data[i * 4] = (v >> 8) & 0xff; // 高字节
    image.data[i * 4 + 1] = v & 0xff; // 低字节
    image.data[i * 4 + 2] = 0;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * 从 canvas 读取 16 位灰度数组（R/G 通道重组）。
 */
export function readCanvasGrayscale16(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): Uint16Array {
  const ctx = get2DContext(canvas);
  const image = ctx.getImageData(0, 0, width, height);
  const values = new Uint16Array(width * height);
  for (let i = 0; i < width * height; i++) {
    values[i] = ((image.data[i * 4] << 8) | image.data[i * 4 + 1]) & 0xffff;
  }
  return values;
}

/**
 * 将 canvas 导出为严格 16 位灰度 PNG Blob。
 *
 * Cities: Skylines 要求 16 位深度的高度图，8 位会导致地形台阶
 * （terracing）——只使用高字节会把 65536 级高度压成 256 级。
 *
 * @param canvas - 存储 R/G 通道编码灰度值的 canvas
 * @returns image/png Blob（bitDepth=16, colorType=0）
 */
export function exportCanvasAs16BitPNG(canvas: HTMLCanvasElement): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const values = readCanvasGrayscale16(canvas, width, height);
  const png = encodeGrayscale16PNG(width, height, values);
  return new Blob([png], { type: "image/png" });
}