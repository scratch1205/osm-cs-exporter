import * as turf from "@turf/turf";
import type { RoadNetworkData, RoadSegmentType } from "@/types/gameExport";
import { lonLatToLocalMeters } from "@/engine/CityGenerator";
import { computeBBoxCenter } from "@/utils/geo";
import { sampleDEM, type DEMData } from "@/services/terrainService";

// =============================================================================
// OSM highway → 游戏道路等级
// =============================================================================

/** 保留的 highway 类型（其余如 footway/path/steps 全部丢弃） */
const KEPT_HIGHWAYS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
]);

/** highway 值 → 游戏道路等级 */
const HIGHWAY_TO_TYPE: Record<string, RoadSegmentType> = {
  motorway: "Highway",
  trunk: "Highway",
  primary: "Highway",
  secondary: "Arterial",
  tertiary: "Arterial",
  residential: "Local",
};

/** turf simplify 容差（度）。0.00005 ≈ 5.5 米，移除微节点防引擎崩溃 */
const DEFAULT_SIMPLIFY_TOLERANCE = 0.00005;

// =============================================================================
// 选项
// =============================================================================

export interface RoadNetworkOptions {
  /** 投影原点 [lon, lat]；缺省从全部数据的外包矩形中心计算 */
  origin?: [number, number];
  /** DEM 数据（可选）。提供时节点 y 从 DEM 双线性采样，否则 y=0 */
  dem?: DEMData;
  /** simplify 容差（度），默认 0.00005 */
  simplifyTolerance?: number;
}

// =============================================================================
// 实现
// =============================================================================

/**
 * 将 OSM 道路要素处理为游戏可导入的矢量路网。
 *
 * 处理流程：
 * 1. 过滤 highway 类型：保留 motorway/trunk/primary/secondary/tertiary/
 *    residential，丢弃 footway/path/steps 等
 * 2. 用 @turf/turf simplify 简化线几何（tolerance 0.00005 ≈ 5.5m），
 *    移除微节点——游戏引擎在节点过多时会崩溃
 * 3. 经纬度投影为相对 bbox 中心的米制坐标（经度→x，纬度→z）
 * 4. 节点按坐标去重：多道路共享的路口合并为同一节点
 * 5. 高度 y 从 DEM 双线性采样；无 DEM 时为 0（平地）
 *
 * @param osmGeoJSON - osmtogeojson 转换后的 GeoJSON
 * @param options - 原点 / DEM / 简化容差
 * @returns 去重后的节点与道路段
 */
export function processRoadNetwork(
  osmGeoJSON: GeoJSON.FeatureCollection,
  options: RoadNetworkOptions = {}
): RoadNetworkData {
  const { dem, simplifyTolerance = DEFAULT_SIMPLIFY_TOLERANCE } = options;
  const origin =
    options.origin ?? computeBBoxCenter(osmGeoJSON.features);

  const nodes: RoadNetworkData["nodes"] = [];
  const segments: RoadNetworkData["segments"] = [];
  /** 坐标 → 节点 ID 索引（路口合并去重） */
  const nodeIndex = new Map<string, string>();

  /** 取或建节点：同坐标复用，不同坐标新建 */
  const getOrCreateNode = (
    lon: number,
    lat: number
  ): string => {
    const [x, z] = lonLatToLocalMeters(lon, lat, origin);
    const y = dem ? sampleDEM(dem, lon, lat) : 0;
    const key = `${x},${z}`;

    const existing = nodeIndex.get(key);
    if (existing) return existing;

    const id = `n${nodes.length}`;
    nodes.push({ id, x, y, z });
    nodeIndex.set(key, id);
    return id;
  };

  for (const feature of osmGeoJSON.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const highway = props["highway"];
    if (typeof highway !== "string") continue;
    if (!KEPT_HIGHWAYS.has(highway)) continue;

    const segmentType = HIGHWAY_TO_TYPE[highway];
    if (!segmentType) continue; // 理论上不可达，防御

    const geometry = feature.geometry;
    const lines: GeoJSON.Position[][] =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];

    for (const line of lines) {
      if (line.length < 2) continue;

      // turf simplify：移除微节点，降低节点数（防游戏引擎崩溃）
      const lineFeature = turf.simplify(
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: line },
          properties: {},
        },
        { tolerance: simplifyTolerance, highQuality: false }
      );
      const simplified = lineFeature.geometry.coordinates;
      if (simplified.length < 2) continue;

      // 逐点建节点（同坐标自动合并）并连线
      let prevId = getOrCreateNode(simplified[0][0], simplified[0][1]);
      for (let i = 1; i < simplified.length; i++) {
        const currId = getOrCreateNode(
          simplified[i][0],
          simplified[i][1]
        );
        segments.push({
          startNodeId: prevId,
          endNodeId: currId,
          type: segmentType,
        });
        prevId = currId;
      }
    }
  }

  return { nodes, segments };
}