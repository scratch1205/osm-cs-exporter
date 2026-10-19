import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import osmtogeojson from "osmtogeojson";
import { buildCity, CityDataEmptyError } from "../services/buildCity";

vi.mock("osmtogeojson", () => ({
  default: vi.fn(),
}));

const mockBbox: [number, number, number, number] = [39.9, 116.3, 39.95, 116.4];

function mockFetchElements(elements: unknown[]): void {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ elements }),
  } as Response);
}

describe("buildCity", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("获取 → 处理 → 生成 Group 全链路", async () => {
    mockFetchElements([
      {
        type: "way",
        id: 1,
        nodes: [1, 2],
        tags: { highway: "residential" },
      },
      {
        type: "way",
        id: 2,
        nodes: [3, 4, 5, 6, 3],
        tags: { building: "yes", "building:levels": "3" },
      },
      { type: "node", id: 1, lat: 39.9, lon: 116.3 },
      { type: "node", id: 2, lat: 39.901, lon: 116.301 },
      { type: "node", id: 3, lat: 39.9, lon: 116.3 },
      { type: "node", id: 4, lat: 39.9, lon: 116.301 },
      { type: "node", id: 5, lat: 39.901, lon: 116.301 },
      { type: "node", id: 6, lat: 39.901, lon: 116.3 },
    ]);
    vi.mocked(osmtogeojson).mockReturnValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [116.3, 39.9],
              [116.301, 39.901],
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
                [116.3, 39.9],
                [116.301, 39.9],
                [116.301, 39.901],
                [116.3, 39.901],
                [116.3, 39.9],
              ],
            ],
          },
          properties: { building: "yes", "building:levels": "3" },
        },
      ],
    } as never);

    const group = await buildCity(mockBbox);

    expect(group).toBeInstanceOf(THREE.Group);
    const instanced = group.children.filter(
      (c) => c instanceof THREE.InstancedMesh
    );
    expect(instanced.length).toBeGreaterThan(0);
    expect(instanced[0].count).toBe(1);
  });

  it("Overpass 返回空数据时抛出 CityDataEmptyError", async () => {
    mockFetchElements([]);
    vi.mocked(osmtogeojson).mockReturnValue({
      type: "FeatureCollection",
      features: [],
    } as never);

    await expect(buildCity(mockBbox)).rejects.toBeInstanceOf(
      CityDataEmptyError
    );
  });

  it("处理后的数据不含道路/建筑时抛出 CityDataEmptyError", async () => {
    mockFetchElements([
      { type: "way", id: 9, nodes: [1, 2], tags: { amenity: "restaurant" } },
      { type: "node", id: 1, lat: 39.9, lon: 116.3 },
      { type: "node", id: 2, lat: 39.9, lon: 116.301 },
    ]);
    vi.mocked(osmtogeojson).mockReturnValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [116.3, 39.9],
          },
          properties: { amenity: "restaurant" },
        },
      ],
    } as never);

    await expect(buildCity(mockBbox)).rejects.toBeInstanceOf(
      CityDataEmptyError
    );
  });
});