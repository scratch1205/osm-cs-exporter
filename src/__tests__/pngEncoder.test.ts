import { describe, it, expect } from "vitest";
import UPNG from "upng-js";
import { encodeGrayscale16PNG } from "../utils/pngEncoder";

describe("encodeGrayscale16PNG", () => {
  it("输出合法 PNG 文件头（魔数）", () => {
    const png = encodeGrayscale16PNG(2, 2, new Uint16Array([0, 1, 2, 3]));
    expect([...png.slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("IHDR 声明 16 位灰度（bitDepth=16, colorType=0）", () => {
    const png = encodeGrayscale16PNG(2, 2, new Uint16Array([0, 1, 2, 3]));
    // IHDR 数据从 offset 8 开始：width(4) height(4) depth(1) colorType(1)
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(2); // width
    expect(view.getUint32(20)).toBe(2); // height
    expect(png[24]).toBe(16); // bit depth === 16（关键）
    expect(png[25]).toBe(0); // color type 0 = 灰度
  });

  it("UPNG 解码确认位深 16 且像素值完全保真", () => {
    const width = 5;
    const height = 3;
    const values = [0, 1, 32768, 65535, 12345, 54321, 999, 45000, 20000, 3000, 7777, 8888, 1111, 2222, 3333];
    const data = new Uint16Array(values);

    const png = encodeGrayscale16PNG(width, height, data);
    const decoded = UPNG.decode(
      png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
    );

    expect(decoded.depth).toBe(16); // 必须是 16 位，C:S 需要避免地形台阶
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);

    // 16 位灰度解码数据：每像素 2 字节大端序（@types 将 data 声明为
    // ArrayBuffer，运行时实为 Uint8Array）
    const decodedData = decoded.data as unknown as Uint8Array;
    const dv = new DataView(
      decodedData.buffer,
      decodedData.byteOffset,
      decodedData.byteLength
    );
    for (let i = 0; i < values.length; i++) {
      expect(dv.getUint16(i * 2)).toBe(values[i]);
    }
  });

  it("处理单行与单像素边界", () => {
    const png = encodeGrayscale16PNG(1, 1, new Uint16Array([65535]));
    const decoded = UPNG.decode(
      png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
    );
    expect(decoded.depth).toBe(16);
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    const data = decoded.data as unknown as Uint8Array;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    expect(dv.getUint16(0)).toBe(65535);
  });
});