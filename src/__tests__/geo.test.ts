import { describe, it, expect } from "vitest";
import { bboxFromFeature } from "../utils/geo";

describe("bboxFromFeature", () => {
  it("从 Polygon 提取 [south, west, north, east] 边界框", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [116.3, 39.9],
            [116.4, 39.9],
            [116.4, 39.95],
            [116.3, 39.95],
            [116.3, 39.9],
          ],
        ],
      },
      properties: {},
    };

    const bbox = bboxFromFeature(feature);
    expect(bbox).toEqual([39.9, 116.3, 39.95, 116.4]);
  });

  it("支持 MultiPolygon（取全部多边形外包）", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [116.3, 39.9],
              [116.31, 39.9],
              [116.31, 39.91],
              [116.3, 39.91],
              [116.3, 39.9],
            ],
          ],
          [
            [
              [116.4, 39.94],
              [116.41, 39.94],
              [116.41, 39.95],
              [116.4, 39.95],
              [116.4, 39.94],
            ],
          ],
        ],
      },
      properties: {},
    };

    const bbox = bboxFromFeature(feature);
    expect(bbox).toEqual([39.9, 116.3, 39.95, 116.41]);
  });

  it("LineString 返回 null（绘图框必须是面）", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [116.3, 39.9],
          [116.4, 39.95],
        ],
      },
      properties: {},
    };

    expect(bboxFromFeature(feature)).toBeNull();
  });

  it("空坐标返回 null", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [],
      },
      properties: {},
    };

    expect(bboxFromFeature(feature)).toBeNull();
  });
});