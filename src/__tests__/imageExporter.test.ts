import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import UPNG from "upng-js";
import {
  exportCanvasAs16BitPNG,
  writeGrayscale16ToCanvas,
  readCanvasGrayscale16,
} from "../utils/imageExporter";

/**
 * @napi-rs/canvas 的 Canvas 与 DOM HTMLCanvasElement 结构兼容，
 * 经类型断言注入（生产代码默认使用浏览器 document.createElement）。
 */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  return createCanvas(width, height) as unknown as HTMLCanvasElement;
}

describe("writeGrayscale16ToCanvas / readCanvasGrayscale16", () => {
  it("16 位灰度值经 R/G 通道编码后可无损还原", () => {
    const canvas = makeCanvas(4, 1);
    const values = new Uint16Array([0, 32768, 12345, 65535]);

    writeGrayscale16ToCanvas(canvas, values, 4, 1);
    const restored = readCanvasGrayscale16(canvas, 4, 1);

    for (let i = 0; i < values.length; i++) {
      expect(restored[i]).toBe(values[i]);
    }
  });
});

describe("exportCanvasAs16BitPNG", () => {
  it("导出严格 16 位灰度 PNG Blob", async () => {
    const canvas = makeCanvas(16, 16);
    const ctx = canvas.getContext("2d")!;
    // 画一个渐变：x 位置决定 16 位值 → R=高字节 G=低字节
    for (let x = 0; x < 16; x++) {
      const value = Math.round((x / 15) * 65535);
      ctx.fillStyle = `rgb(${(value >> 8) & 255}, ${value & 255}, 0)`;
      ctx.fillRect(x, 0, 1, 16);
    }

    const blob = exportCanvasAs16BitPNG(canvas);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");

    const buffer = await blob.arrayBuffer();
    const decoded = UPNG.decode(buffer);
    expect(decoded.depth).toBe(16);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
  });

  it("导出的像素值误差不超过 1（量化舍入）", async () => {
    const canvas = makeCanvas(3, 1);
    const ctx = canvas.getContext("2d")!;
    const values = [0, 32768, 65535];
    for (let x = 0; x < 3; x++) {
      ctx.fillStyle = `rgb(${(values[x] >> 8) & 255}, ${values[x] & 255}, 0)`;
      ctx.fillRect(x, 0, 1, 1);
    }

    const blob = exportCanvasAs16BitPNG(canvas);
    const decoded = UPNG.decode(await blob.arrayBuffer());
    const data = decoded.data as unknown as Uint8Array;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

    for (let x = 0; x < 3; x++) {
      expect(Math.abs(dv.getUint16(x * 2) - values[x])).toBeLessThanOrEqual(1);
    }
  });
});