import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { generateWaterMask } from "../services/waterService";

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  return createCanvas(width, height) as unknown as HTMLCanvasElement;
}

/** 构造一个 bbox 内居中的矩形水面多边形 */
function makeWaterPolygon(
  bbox: [number, number, number, number]
): GeoJSON.Feature {
  const [south, west, north, east] = bbox;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const halfW = (east - west) / 4;
  const halfH = (north - south) / 4;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [cx - halfW, cy - halfH],
          [cx + halfW, cy - halfH],
          [cx + halfW, cy + halfH],
          [cx - halfW, cy + halfH],
          [cx - halfW, cy - halfH],
        ],
      ],
    },
    properties: { natural: "water" },
  };
}

const bbox: [number, number, number, number] = [0, 0, 10, 10]; // south, west, north, east
const res = 10;

describe("generateWaterMask", () => {
  it("水多边形光栅化为白色（255），背景陆地黑色（0）", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [makeWaterPolygon(bbox)],
    };

    const canvas = makeCanvas(res, res);
    generateWaterMask(collection, bbox, res, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    // 中心像素（水面内）→ 白
    expect(img.data[(5 * res + 5) * 4]).toBe(255);
    // 角落像素（水面外）→ 黑
    expect(img.data[0]).toBe(0);
    expect(img.data[(res * res - 1) * 4]).toBe(0);
  });

  it("waterway=riverbank 同样被识别为水面", () => {
    const riverbank: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [4, 4],
            [6, 4],
            [6, 6],
            [4, 6],
            [4, 4],
          ],
        ],
      },
      properties: { waterway: "riverbank" },
    };
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [riverbank],
    };

    const canvas = makeCanvas(res, res);
    generateWaterMask(collection, bbox, res, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    expect(img.data[(5 * res + 5) * 4]).toBe(255);
  });

  it("没有水数据时输出全黑（全陆地）", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [5, 5] },
          properties: { highway: "residential" },
        },
      ],
    };

    const canvas = makeCanvas(res, res);
    generateWaterMask(collection, bbox, res, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    for (let i = 0; i < res * res; i++) {
      expect(img.data[i * 4]).toBe(0);
    }
  });

  it("支持 MultiPolygon 水要素", () => {
    const multi: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [1, 1],
              [2, 1],
              [2, 2],
              [1, 2],
              [1, 1],
            ],
          ],
          [
            [
              [7, 7],
              [9, 7],
              [9, 9],
              [7, 9],
              [7, 7],
            ],
          ],
        ],
      },
      properties: { natural: "water" },
    };
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [multi],
    };

    const canvas = makeCanvas(res, res);
    generateWaterMask(collection, bbox, res, () => canvas);

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    // 多边形1 经纬 (1,1)-(2,2) → 像素 col 1-2, row 8-9（纬度南移 → 行号增大）
    expect(img.data[(8 * res + 1) * 4]).toBe(255);
    // 多边形2 经纬 (7,7)-(9,9) → 像素 col 7-9, row 1-3
    expect(img.data[(2 * res + 8) * 4]).toBe(255);
    // 中间区域是黑
    expect(img.data[(5 * res + 5) * 4]).toBe(0);
  });
});