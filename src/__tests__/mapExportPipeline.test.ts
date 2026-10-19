import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import UPNG from "upng-js";
import osmtogeojson from "osmtogeojson";
import {
  generateMapExportAssets,
  type MapExportAssets,
} from "../services/mapExportPipeline";

vi.mock("osmtogeojson", () => ({
  default: vi.fn(),
}));

const bbox: [number, number, number, number] = [39.9, 116.38, 39.92, 116.4];

/** 用 upng 生成 terrarium 瓦片（纯色 = 海平面 0 米） */
function makeTilePng(): ArrayBuffer {
  const w = 8;
  const h = 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 128; // terrarium: R=128 → 0 米
    rgba[i * 4 + 3] = 255;
  }
  return (UPNG.encode as unknown as (
    imgs: Uint8Array[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
    forbidPlte?: boolean
  ) => ArrayBuffer)([rgba], w, h, 4, undefined, true);
}

const mockGeoJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [116.38, 39.9],
          [116.4, 39.92],
        ],
      },
      properties: { highway: "residential" },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [116.38, 39.9],
            [116.39, 39.9],
            [116.39, 39.91],
            [116.38, 39.91],
            [116.38, 39.9],
          ],
        ],
      },
      properties: { natural: "water" },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [116.39, 39.91],
            [116.4, 39.91],
            [116.4, 39.92],
            [116.39, 39.92],
            [116.39, 39.91],
          ],
        ],
      },
      properties: { natural: "wood" },
    },
  ],
};

describe("generateMapExportAssets", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("overpass")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify({ elements: [] }),
          } as Response;
        }
        if (url.includes("terrarium")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            arrayBuffer: async () => makeTilePng(),
          } as Response;
        }
        return { ok: false, status: 404, statusText: "Not Found" } as Response;
      })
    );
    vi.mocked(osmtogeojson).mockReturnValue(mockGeoJSON as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("生成高度图/水/树/路网四个 Blob", async () => {
    const assets = await generateMapExportAssets(bbox, 16, () =>
      createCanvas(16, 16) as unknown as HTMLCanvasElement
    );

    expect(assets.heightmap).toBeInstanceOf(Blob);
    expect(assets.waterMask).toBeInstanceOf(Blob);
    expect(assets.treeMask).toBeInstanceOf(Blob);
    expect(assets.roadNetwork).toBeInstanceOf(Blob);
  });

  it("高度图为 16 位灰度 PNG", async () => {
    const assets = await generateMapExportAssets(bbox, 16, () =>
      createCanvas(16, 16) as unknown as HTMLCanvasElement
    );
    const decoded = UPNG.decode(await assets.heightmap.arrayBuffer());
    expect(decoded.depth).toBe(16);
    expect(decoded.width).toBe(16);
  });

  it("路网 Blob 为合法 JSON（RoadNetworkData 结构）", async () => {
    const assets = await generateMapExportAssets(bbox, 16, () =>
      createCanvas(16, 16) as unknown as HTMLCanvasElement
    );
    const text = await assets.roadNetwork.text();
    const parsed = JSON.parse(text) as {
      nodes: unknown[];
      segments: unknown[];
    };
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.segments)).toBe(true);
    // residential → Local
    expect(parsed.segments[0]).toMatchObject({ type: "Local" });
  });

  it("水掩膜与树掩膜为合法 PNG", async () => {
    const assets = await generateMapExportAssets(bbox, 16, () =>
      createCanvas(16, 16) as unknown as HTMLCanvasElement
    );
    for (const blob of [assets.waterMask, assets.treeMask]) {
      const decoded = UPNG.decode(await blob.arrayBuffer());
      expect(decoded.width).toBe(16);
      expect(decoded.height).toBe(16);
    }
  });

  it("全部文件可被打包为 C:S zip（5 个文件）", async () => {
    const assets: MapExportAssets = await generateMapExportAssets(bbox, 16, () =>
      createCanvas(16, 16) as unknown as HTMLCanvasElement
    );
    const zip = await JSZip.loadAsync(
      // 直接复用 buildCSMapPackage 的 zip 验证：这里只验证 4 个资产可组装
      await (async () => {
        const { buildCSMapPackage } = await import(
          "../services/exportPackageService"
        );
        return buildCSMapPackage(
          assets.heightmap,
          assets.waterMask,
          assets.treeMask,
          assets.roadNetwork
        );
      })()
    );
    const files = Object.keys(zip.files).filter((n) => !n.endsWith("/"));
    expect(files).toHaveLength(5);
  });
});