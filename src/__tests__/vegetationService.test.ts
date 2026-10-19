import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  generateTreeMask,
  vegetationIntensityFor,
  type VegetationTag,
} from "../services/vegetationService";

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  return createCanvas(width, height) as unknown as HTMLCanvasElement;
}

const bbox: [number, number, number, number] = [0, 0, 10, 10]; // south, west, north, east
const res = 10;

/** 构造 bbox 内居中的矩形植被多边形 */
function makeVegetationPolygon(
  tag: VegetationTag,
  value: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
    properties: { [tag]: value },
  };
}

const wood = () =>
  makeVegetationPolygon("natural", "wood", 2, 2, 8, 8);
const forest = () =>
  makeVegetationPolygon("landuse", "forest", 2, 2, 8, 8);
const park = () => makeVegetationPolygon("leisure", "park", 2, 2, 8, 8);
const scrub = () =>
  makeVegetationPolygon("natural", "scrub", 2, 2, 8, 8);

function centerIntensity(canvas: HTMLCanvasElement): number {
  const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
  return img.data[(5 * res + 5) * 4]; // R 通道即强度
}

describe("vegetationIntensityFor", () => {
  it("四类标签返回对应强度", () => {
    expect(vegetationIntensityFor("natural", "wood")).toBe(255);
    expect(vegetationIntensityFor("landuse", "forest")).toBe(230);
    expect(vegetationIntensityFor("leisure", "park")).toBe(128);
    expect(vegetationIntensityFor("natural", "scrub")).toBe(160);
  });

  it("未知标签返回 null", () => {
    expect(vegetationIntensityFor("natural", "water")).toBeNull();
    expect(vegetationIntensityFor("building", "yes")).toBeNull();
  });
});

describe("generateTreeMask", () => {
  it("wood 密林渲染为 255（白色）", () => {
    const canvas = makeCanvas(res, res);
    generateTreeMask(
      {
        type: "FeatureCollection",
        features: [wood()],
      },
      bbox,
      res,
      () => canvas
    );
    expect(centerIntensity(canvas)).toBe(255);
    // 角落（多边形外）为黑
    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    expect(img.data[0]).toBe(0);
  });

  it("四种标签按各自强度渲染", () => {
    const expectIntensity = (
      feature: GeoJSON.Feature,
      expected: number
    ) => {
      const canvas = makeCanvas(res, res);
      generateTreeMask(
        { type: "FeatureCollection", features: [feature] },
        bbox,
        res,
        () => canvas
      );
      expect(centerIntensity(canvas)).toBe(expected);
    };

    expectIntensity(wood(), 255);
    expectIntensity(forest(), 230);
    expectIntensity(park(), 128);
    expectIntensity(scrub(), 160);
  });

  it("重叠区域取最大值（公园内的树林 → 255）", () => {
    // 大公园（128）覆盖大部分区域，小树林（255）在中心
    const parkFeature = makeVegetationPolygon("leisure", "park", 1, 1, 9, 9);
    const woodFeature = makeVegetationPolygon("natural", "wood", 3.5, 3.5, 6.5, 6.5);

    const canvas = makeCanvas(res, res);
    generateTreeMask(
      { type: "FeatureCollection", features: [parkFeature, woodFeature] },
      bbox,
      res,
      () => canvas
    );

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    // 中心 = 树林区 → 255（不被公园 128 覆盖）
    expect(img.data[(5 * res + 5) * 4]).toBe(255);
    // 边缘 = 仅公园 → 128
    expect(img.data[(2 * res + 2) * 4]).toBe(128);
    // 角落 = 无植被 → 0
    expect(img.data[0]).toBe(0);
  });

  it("没有植被数据时输出全黑", () => {
    const canvas = makeCanvas(res, res);
    generateTreeMask(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [5, 5] },
            properties: { highway: "residential" },
          },
        ],
      },
      bbox,
      res,
      () => canvas
    );

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    for (let i = 0; i < res * res; i++) {
      expect(img.data[i * 4]).toBe(0);
    }
  });

  it("支持 MultiPolygon 植被要素", () => {
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
      properties: { natural: "wood" },
    };

    const canvas = makeCanvas(res, res);
    generateTreeMask(
      { type: "FeatureCollection", features: [multi] },
      bbox,
      res,
      () => canvas
    );

    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    // 多边形1 经纬 (1,1)-(2,2) → 像素 col 1-2, row 8-9（纬度南移 → 行号增大）
    expect(img.data[(8 * res + 1) * 4]).toBe(255);
    // 多边形2 经纬 (7,7)-(9,9) → 像素 col 7-9, row 1-3
    expect(img.data[(2 * res + 8) * 4]).toBe(255);
    // 中间区域无树
    expect(img.data[(5 * res + 5) * 4]).toBe(0);
  });

  it("G 通道与 R 通道一致（16 位导出时高/低字节相等）", () => {
    const canvas = makeCanvas(res, res);
    generateTreeMask(
      { type: "FeatureCollection", features: [wood()] },
      bbox,
      res,
      () => canvas
    );
    const img = canvas.getContext("2d")!.getImageData(0, 0, res, res);
    const idx = (5 * res + 5) * 4;
    expect(img.data[idx]).toBe(255);
    expect(img.data[idx + 1]).toBe(255);
  });
});