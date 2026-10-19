import { deflate } from "pako";

// =============================================================================
// 16 位灰度 PNG 编码器（PNG 规范：IHDR bitDepth=16, colorType=0）
//
// 为什么不用 upng-js 编码：实测 upng-js 2.1.0 的 encode.compress 只支持
// 8 位 RGBA 输入（每像素 4 字节），没有 16 位深度输出路径（decode 支持
// 16 位但 encode 不支持）。Cities: Skylines 需要严格 16 位灰度 PNG，
// 否则导入后会出现地形台阶（terracing）。故自研符合 PNG 规范的编码器。
// =============================================================================

/** CRC-32 查找表（PNG 规范多项式 0xEDB88320） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构造一个 PNG chunk：length(4) + type(4) + data + CRC(4) */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/**
 * 将 16 位灰度像素数组编码为 PNG 文件（严格 16 位，非 8 位）。
 *
 * @param width - 图像宽度（像素）
 * @param height - 图像高度（像素）
 * @param data - 灰度值 0-65535，行主序，长度必须为 width × height
 * @returns 完整 PNG 文件字节
 */
export function encodeGrayscale16PNG(
  width: number,
  height: number,
  data: Uint16Array
): Uint8Array {
  if (width <= 0 || height <= 0) {
    throw new Error(`无效的图像尺寸: ${width}x${height}`);
  }
  if (data.length !== width * height) {
    throw new Error(
      `像素数据长度不匹配: 期望 ${width * height}，实际 ${data.length}`
    );
  }

  // 扫描线：每行 1 字节 filter（None）+ width × 2 字节（16 位大端灰度）
  const stride = width * 2;
  const raw = new Uint8Array((stride + 1) * height);
  const view = new DataView(raw.buffer);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 = None
    for (let x = 0; x < width; x++) {
      view.setUint16(rowStart + 1 + x * 2, data[y * width + x]);
    }
  }

  const compressed = deflate(raw);

  // IHDR：width(4) height(4) bitDepth(1)=16 colorType(1)=0 compression filter interlace
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 16; // bit depth：16 位（关键）
  ihdr[9] = 0; // color type 0：灰度（非 RGB）
  ihdr[10] = 0; // 压缩方法
  ihdr[11] = 0; // 滤波方法
  ihdr[12] = 0; // 隔行扫描：无

  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const parts = [
    signature,
    buildChunk("IHDR", ihdr),
    buildChunk("IDAT", compressed),
    buildChunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}