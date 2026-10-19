import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import UPNG from "upng-js";
import {
  fetchDEMData,
  generateHeightmap,
  decodeTerrariumTile,
  pickZoomLevel,
  type DEMData,
} from "../services/terrainService";

/** 用 upng 生成一个纯色 256x256 RGBA 瓦片 PNG（模拟 AWS Terrarium 瓦片） */
function makeTilePng(r: number, g: number, b: number): ArrayBuffer {
  const width = 256;
  const height = 256;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  // @types/upng-js 缺少 forbidPlte 参数声明，运行时支持
  return (UPNG.encode as unknown as (
    imgs: Uint8Array[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
    forbidPlte?: boolean
  ) => ArrayBuffer)([rgba], width, height, 4, undefined, true);
}

describe("decodeTerrariumTile", () => {
  it("按 terrarium 公式解码海拔：R*256 + G + B/256 - 32768", async () => {
    // R=100, G=50, B=128 → 100*256 + 50 + 0.5 - 32768 = -7117.5
    const png = makeTilePng(100, 50, 128);
    const { elevations, width, height } = await decodeTerrariumTile(png);

    expect(width).toBe(256);
    expect(height).toBe(256);
    expect(elevations[0]).toBeCloseTo(-7117.5, 4);
    expect(elevations[255]).toBeCloseTo(-7117.5, 4);
    expect(elevations.length).toBe(256 * 256);
  });

  it("海平面基准：R=128,G=0,B=0 → 0 米", async () => {
    const png = makeTilePng(128, 0, 0);
    const { elevations } = await decodeTerrariumTile(png);
    expect(elevations[0]).toBeCloseTo(0, 4);
  });
});

describe("pickZoomLevel", () => {
  it("城市尺度 bbox 选择合理 zoom（覆盖 1..8 个瓦片）", () => {
    // 北京约 0.02° × 0.02°（约 2km）
    const zoom = pickZoomLevel([39.9, 116.38, 39.92, 116.4]);
    expect(zoom).toBeGreaterThanOrEqual(12);
    expect(zoom).toBeLessThanOrEqual(16);
  });

  it("zoom 随 bbox 增大而减小", () => {
    const small = pickZoomLevel([39.9, 116.38, 39.92, 116.4]);
    const large = pickZoomLevel([39.5, 116.0, 40.5, 117.0]);
    expect(large).toBeLessThan(small);
  });
});

describe("fetchDEMData", () => {
  let requestedUrls: string[];

  beforeEach(() => {
    requestedUrls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (!url.includes("terrarium")) {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => makeTilePng(128, 0, 0), // 海平面瓦片
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("请求 AWS Terrarium 瓦片并拼接为 DEM 栅格", async () => {
    const bbox: [number, number, number, number] = [39.9, 116.38, 39.92, 116.4];

    const dem = await fetchDEMData(bbox, 1081);

    expect(dem.width).toBeGreaterThan(0);
    expect(dem.height).toBeGreaterThan(0);
    expect(dem.elevations.length).toBe(dem.width * dem.height);
    // 所有瓦片都是海平面 → 全部 ≈ 0 米
    expect(dem.elevations[0]).toBeCloseTo(0, 2);
  });

  it("请求的 URL 符合 terrarium 瓦片规范 /terrarium/{z}/{x}/{y}.png", async () => {
    await fetchDEMData([39.9, 116.38, 39.92, 116.4], 1081);

    expect(requestedUrls.length).toBeGreaterThan(0);
    for (const url of requestedUrls) {
      expect(url).toMatch(/terrarium\/\d+\/\d+\/\d+\.png$/);
      expect(url).toContain("elevation-tiles-prod");
    }
  });

  it("返回的 DEM 覆盖范围包含请求 bbox", async () => {
    const bbox: [number, number, number, number] = [39.9, 116.38, 39.92, 116.4];

    const dem = await fetchDEMData(bbox, 1081);

    expect(dem.bbox[0]).toBeLessThanOrEqual(bbox[0]); // south
    expect(dem.bbox[1]).toBeLessThanOrEqual(bbox[1]); // west
    expect(dem.bbox[2]).toBeGreaterThanOrEqual(bbox[2]); // north
    expect(dem.bbox[3]).toBeGreaterThanOrEqual(bbox[3]); // east
  });

  it("瓦片请求失败时抛出错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
    } as Response));

    await expect(
      fetchDEMData([39.9, 116.38, 39.92, 116.4], 1081)
    ).rejects.toThrow(/瓦片/);
  });
});

describe("generateHeightmap", () => {
  it("按 C:S 固定映射写入 16 位值：像素值 = 海拔米 × 64（不做归一化）", () => {
    // 2x2 DEM：西北 0m，东北 100m，西南 50m，东南 200m
    const dem: DEMData = {
      width: 2,
      height: 2,
      elevations: new Float32Array([0, 100, 50, 200]),
      bbox: [0, 0, 10, 10], // south, west, north, east
    };
    const canvas = createCanvas(2, 2) as unknown as HTMLCanvasElement;

    // resolution=2 → 输出像素与 DEM 角点一一对应
    generateHeightmap(dem, [0, 0, 10, 10], 2, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, 2, 2);
    const px = (x: number, y: number) => (y * 2 + x) * 4;

    // (0,0)=0m → 0 → R=0 G=0
    expect(img.data[px(0, 0)]).toBe(0);
    expect(img.data[px(0, 0) + 1]).toBe(0);
    // (1,0)=100m → 100×64=6400 → R=25 G=0
    expect(img.data[px(1, 0)]).toBe(25);
    expect(img.data[px(1, 0) + 1]).toBe(0);
    // (0,1)=50m → 3200 → R=12 G=128
    expect(img.data[px(0, 1)]).toBe(12);
    expect(img.data[px(0, 1) + 1]).toBe(128);
    // (1,1)=200m → 12800 → R=50 G=0
    expect(img.data[px(1, 1)]).toBe(50);
    expect(img.data[px(1, 1) + 1]).toBe(0);
    // Alpha 恒为 255
    expect(img.data[px(0, 0) + 3]).toBe(255);
  });

  it("负海拔钳制为 0；超过 1024m 钳制为 65535；40m（默认海平面）=2560", () => {
    const dem: DEMData = {
      width: 2,
      height: 2,
      elevations: new Float32Array([-30, 2000, 1024, 40]),
      bbox: [0, 0, 10, 10],
    };
    const canvas = createCanvas(2, 2) as unknown as HTMLCanvasElement;
    generateHeightmap(dem, [0, 0, 10, 10], 2, () => canvas);
    const img = canvas.getContext("2d")!.getImageData(0, 0, 2, 2);
    const view = (x: number, y: number) => (y * 2 + x) * 4;
    expect(img.data[view(0, 0)]).toBe(0);          // -30m → 0
    expect(img.data[view(1, 0)]).toBe(255);        // 2000m → clamp→65535
    expect(img.data[view(0, 1)]).toBe(255);        // 1024m → 65535
    expect(img.data[view(1, 1)]).toBe(10);         // 40m → 2560 → R=10
    expect(img.data[view(1, 1) + 1]).toBe(0);
  });

  it("维度映射：north→上、west→左、east→右、south→下", () => {
    const dem: DEMData = {
      width: 2,
      height: 2,
      elevations: new Float32Array([100, 200, 0, 50]), // 北高南低
      bbox: [0, 0, 10, 10],
    };
    const canvas = createCanvas(2, 2) as unknown as HTMLCanvasElement;

    generateHeightmap(dem, [0, 0, 10, 10], 2, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, 2, 2);
    // 北行（y=0）亮度高于南行（y=1）
    const northBrightness = img.data[0] + img.data[1]; // (0,0)=100m
    const southBrightness = img.data[8] + img.data[9]; // (0,1)=0m
    expect(northBrightness).toBeGreaterThan(southBrightness);
  });

  it("平原（50m）按绝对海拔输出 3200 而非 0", () => {
    const dem: DEMData = {
      width: 2,
      height: 2,
      elevations: new Float32Array([50, 50, 50, 50]),
      bbox: [0, 0, 10, 10],
    };
    const canvas = createCanvas(2, 2) as unknown as HTMLCanvasElement;

    generateHeightmap(dem, [0, 0, 10, 10], 2, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, 2, 2);
    // 50m 绝对海拔 → 50×64=3200 → R=12 G=128（不做归一化，平原保持真实海拔）
    for (let i = 0; i < 4; i++) {
      expect(img.data[i * 4]).toBe(12);
      expect(img.data[i * 4 + 1]).toBe(128);
    }
  });

  it("默认分辨率为 1081", () => {
    const dem: DEMData = {
      width: 2,
      height: 2,
      elevations: new Float32Array([0, 10, 10, 20]),
      bbox: [0, 0, 10, 10],
    };
    const canvas = createCanvas(1081, 1081) as unknown as HTMLCanvasElement;

    generateHeightmap(dem, [0, 0, 10, 10], undefined, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, 1081, 1081);
    expect(img.width).toBe(1081);
    expect(img.height).toBe(1081);
  });
});