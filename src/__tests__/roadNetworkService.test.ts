import { describe, it, expect } from "vitest";
import { processRoadNetwork } from "../services/roadNetworkService";
import type { DEMData } from "../services/terrainService";

/** 构造一条道路 LineString Feature */
function road(
  coords: [number, number][],
  highway: string
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: { highway },
  };
}

/** 构造一个 2x2 已知高度的 DEM（角点：NW=0, NE=100, SW=50, SE=200） */
const testDEM: DEMData = {
  width: 2,
  height: 2,
  elevations: new Float32Array([0, 100, 50, 200]),
  bbox: [0, 0, 10, 10], // south, west, north, east
};

describe("processRoadNetwork", () => {
  it("保留核心道路并映射到游戏道路等级", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        road([[0, 0], [1, 0]], "motorway"),
        road([[0, 1], [1, 1]], "secondary"),
        road([[0, 2], [1, 2]], "residential"),
      ],
    };

    const result = processRoadNetwork(collection, { origin: [0, 0] });

    const types = result.segments.map((s) => s.type).sort();
    expect(types).toEqual(["Arterial", "Highway", "Local"]);
  });

  it("丢弃 footway / path / steps", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        road([[0, 0], [1, 0]], "motorway"),
        road([[0, 1], [1, 1]], "footway"),
        road([[0, 2], [1, 2]], "path"),
        road([[0, 3], [1, 3]], "steps"),
      ],
    };

    const result = processRoadNetwork(collection, { origin: [0, 0] });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("Highway");
  });

  it("motorway/trunk/primary → Highway，secondary/tertiary → Arterial，residential → Local", () => {
    const cases: [string, string][] = [
      ["motorway", "Highway"],
      ["trunk", "Highway"],
      ["primary", "Highway"],
      ["secondary", "Arterial"],
      ["tertiary", "Arterial"],
      ["residential", "Local"],
    ];

    for (const [highway, expected] of cases) {
      const result = processRoadNetwork(
        { type: "FeatureCollection", features: [road([[0, 0], [1, 0]], highway)] },
        { origin: [0, 0] }
      );
      expect(result.segments[0].type).toBe(expected);
    }
  });

  it("turf simplify 移除微节点（共线密集点 → 仅保留端点）", () => {
    // 0.00001° 间隔的 20 个共线点
    const coords: [number, number][] = [];
    for (let i = 0; i < 20; i++) {
      coords.push([i * 0.00001, 0]);
    }
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [road(coords, "residential")],
    };

    const result = processRoadNetwork(collection, { origin: [0, 0] });

    // tolerance 0.00005 下共线点全部并入两端点
    expect(result.nodes).toHaveLength(2);
    expect(result.segments).toHaveLength(1);
  });

  it("坐标转换为相对原点的米制 X/Z（经度→X，纬度→Z）", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        road(
          [
            [0, 0],
            [0.0001, 0], // 经度 +0.0001° → x ≈ 11.13 米（赤道）
          ],
          "residential"
        ),
      ],
    };

    const result = processRoadNetwork(collection, { origin: [0, 0] });

    expect(result.nodes).toHaveLength(2);
    const end = result.nodes[1];
    expect(end.x).toBeCloseTo(11.13, 0);
    expect(end.z).toBeCloseTo(0, 6);
    expect(end.y).toBe(0); // 无 DEM → y=0
  });

  it("无 DEM 时高度 y 为 0", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [road([[0, 0], [1, 1]], "primary")],
    };
    const result = processRoadNetwork(collection);
    for (const node of result.nodes) {
      expect(node.y).toBe(0);
    }
  });

  it("提供 DEM 时 y 从 DEM 采样", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        road(
          [
            [0, 10], // 西北角 → DEM 值 0
            [10, 0], // 东南角 → DEM 值 200
          ],
          "primary"
        ),
      ],
    };

    const result = processRoadNetwork(collection, { dem: testDEM });

    expect(result.nodes[0].y).toBeCloseTo(0, 2);
    expect(result.nodes[1].y).toBeCloseTo(200, 2);
  });

  it("共享路口的节点合并（两条路共用一个端节点）", () => {
    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        road([[0, 0], [10, 0]], "residential"),
        road([[10, 0], [10, 10]], "secondary"),
      ],
    };

    const result = processRoadNetwork(collection);

    // 3 个唯一节点（两条路共享 (10,0)），2 个 segment
    expect(result.nodes).toHaveLength(3);
    expect(result.segments).toHaveLength(2);

    // 两个 segment 通过共享节点相连
    const segA = result.segments[0];
    const segB = result.segments[1];
    const sharedNodeIds = new Set([segA.startNodeId, segA.endNodeId]);
    expect(sharedNodeIds.has(segB.startNodeId) || sharedNodeIds.has(segB.endNodeId)).toBe(true);
  });

  it("空输入返回空结构", () => {
    const result = processRoadNetwork({
      type: "FeatureCollection",
      features: [],
    });
    expect(result.nodes).toHaveLength(0);
    expect(result.segments).toHaveLength(0);
  });

  it("MultiLineString 拆分为多条线段", () => {
    const multi: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [0, 0],
            [1, 0],
          ],
          [
            [2, 0],
            [3, 0],
          ],
        ],
      },
      properties: { highway: "residential" },
    };

    const result = processRoadNetwork(
      { type: "FeatureCollection", features: [multi] },
      { origin: [0, 0] }
    );

    expect(result.segments).toHaveLength(2);
    expect(result.nodes).toHaveLength(4);
  });
});