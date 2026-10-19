import * as THREE from "three";
import { disposeObject3D } from "@/utils/dispose";
import { computeBBoxCenter } from "@/utils/geo";
import {
  BUILDING_COLORS,
  FALLBACK_BUILDING_COLOR,
  ROAD_COLORS,
  FALLBACK_ROAD_COLOR,
} from "@/utils/constants";

// =============================================================================
// 常量
// =============================================================================

/** 单个 InstancedMesh 的最大实例数（超过则拆分批次） */
export const MAX_INSTANCES_PER_BATCH = 50_000;

/** 赤道附近每 1 度纬度对应的米数（等距圆柱投影基准） */
const METERS_PER_DEGREE_LAT = 111_320;

/** 建筑按高度分组的桶大小（米）。同桶共享一个 ExtrudeGeometry。 */
const HEIGHT_BUCKET_SIZE = 3;

/** 单位挤出几何的挤出深度（米）。真实高度通过实例 scale.z 表达。 */
const UNIT_EXTRUDE_DEPTH = 1;

/** 道路 UV 沿路方向的缩放（每米多少个 UV 周期）。0.1 = 每 10 米重复一次。 */
const ROAD_UV_SCALE_PER_METER = 0.1;

/** 建筑高度缺失/非法时的兜底值（米） */
const FALLBACK_HEIGHT = 10;

/** 道路宽度缺失/非法时的兜底值（米） */
const FALLBACK_WIDTH = 6;

/** 绕 Z 轴旋转用的单位向量（常量复用） */
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// =============================================================================
// 坐标投影
// =============================================================================

/**
 * 将 WGS84 经纬度投影为相对原点的本地米制坐标（等距圆柱近似）。
 *
 * 以 origin 为原点：
 *   x = (lon - originLon) × 111320 × cos(originLat)
 *   y = (lat - originLat) × 111320
 *
 * 该近似在城区尺度（< 10 km）误差小于 0.1%，满足 3D 城市渲染需求，
 * 且比 turf.destination 逐点计算快几个数量级。
 *
 * @param lon - 经度（度）
 * @param lat - 纬度（度）
 * @param origin - 投影原点 [lon, lat]
 * @returns 米制坐标 [x, y]
 */
export function lonLatToLocalMeters(
  lon: number,
  lat: number,
  origin: [number, number]
): [number, number] {
  const metersPerDegreeLon =
    METERS_PER_DEGREE_LAT * Math.cos((origin[1] * Math.PI) / 180);
  return [
    (lon - origin[0]) * metersPerDegreeLon,
    (lat - origin[1]) * METERS_PER_DEGREE_LAT,
  ];
}

// =============================================================================
// 内部工具
// =============================================================================

/** 将 "#rrggbb" 十六进制颜色解析为 0..1 的 [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

/** 从要素 properties 中安全读取字符串值 */
function getStringProp(
  props: Record<string, unknown>,
  key: string
): string | undefined {
  const v = props[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** 高度分桶：按 3m 一档向下取整（10m 与 11m 同属 [9,12) 桶） */
function heightBucket(height: number): number {
  return Math.max(1, Math.floor(height / HEIGHT_BUCKET_SIZE)) * HEIGHT_BUCKET_SIZE;
}

/** 取建筑 footprint 的外环坐标（Polygon 取首个 ring，MultiPolygon 取面积最大者） */
function getOuterRingCoords(
  geometry: GeoJSON.Geometry
): [number, number][] | null {
  if (geometry.type === "Polygon") {
    return geometry.coordinates[0] as [number, number][];
  }
  if (geometry.type === "MultiPolygon") {
    let largest: [number, number][] | null = null;
    let largestArea = -1;
    for (const polygon of geometry.coordinates) {
      const ring = polygon[0] as [number, number][];
      // 鞋带公式计算面积（度²，仅用于比较大小）
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      area = Math.abs(area) / 2;
      if (area > largestArea) {
        largestArea = area;
        largest = ring;
      }
    }
    return largest;
  }
  return null;
}

/** 计算多边形首条边（p0→p1）的方向角（弧度），用于实例绕 Z 轴旋转 */
function footprintRotationZ(ring: [number, number][]): number {
  const p0 = ring[0];
  const p1 = ring[1] ?? ring[0];
  return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
}

/** 计算道路折线在顶点 i 处的法线方向（垂直航向的单位向量） */
function vertexNormal(
  pts: [number, number][],
  i: number
): [number, number] {
  const p = pts[i];
  const prev = pts[i - 1];
  const next = pts[i + 1];

  let dir: [number, number];
  if (prev && next) {
    const dx1 = p[0] - prev[0];
    const dy1 = p[1] - prev[1];
    const dx2 = next[0] - p[0];
    const dy2 = next[1] - p[1];
    // 相邻两段方向的平均（转向处平滑）
    let nx = dx1 + dx2;
    let ny = dy1 + dy2;
    const len = Math.hypot(nx, ny);
    if (len < 1e-12) {
      dir = [dx2, dy2];
    } else {
      nx /= len;
      ny /= len;
      dir = [nx, ny];
    }
  } else if (next) {
    dir = [next[0] - p[0], next[1] - p[1]];
  } else if (prev) {
    dir = [p[0] - prev[0], p[1] - prev[1]];
  } else {
    dir = [1, 0];
  }

  const len = Math.hypot(dir[0], dir[1]) || 1;
  // 垂直方向（左法线）
  return [-dir[1] / len, dir[0] / len];
}

// =============================================================================
// 内部数据结构
// =============================================================================

/** 一个等待实例化的建筑 */
interface BuildingEntry {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotationZ: number;
}

/** 建筑分组键：高度桶 + 颜色 */
interface BuildingGroup {
  key: string;
  height: number;
  color: string;
  entries: BuildingEntry[];
}

// =============================================================================
// CityGenerator
// =============================================================================

/**
 * 高性能 3D 城市生成器。
 *
 * 将 Step 2 处理好的道路/建筑 GeoJSON 转为 Three.js 网格，面向大规模
 * 城市渲染做了三项关键优化：
 *
 * 1. **建筑**：不逐栋创建 Mesh。按「相似高度桶 + 材质颜色」分组，
 *    每组共享一个单位 ExtrudeGeometry，用 InstancedMesh 表达全部实例
 *    （position/rotation/scale 写入 instance matrix）。单批上限 50k，
 *    超出自动拆分批次。
 * 2. **道路**：不逐段创建 Mesh。所有道路折线展开为带状（ribbon）
 *    三角形，顶点合并进单个 BufferGeometry，一次 draw call 渲染。
 * 3. **坐标**：经纬度先投影为相对 bbox 中心的本地米制坐标
 *    （等距圆柱近似），场景单位即米。
 */
export class CityGenerator {
  /** 投影原点 [lon, lat]。未指定时由 generate 从数据计算。 */
  private readonly origin: [number, number] | null;

  /** 最近一次 generate 产出的 Group，dispose 时释放其资源 */
  private group: THREE.Group | null = null;

  constructor(options?: { origin?: [number, number] }) {
    this.origin = options?.origin ?? null;
  }

  /**
   * 生成包含全部建筑与道路网格的单个 THREE.Group。
   *
   * @param roads - 道路 GeoJSON Feature 数组（含 width 属性，来自 geoProcessor）
   * @param buildings - 建筑 GeoJSON Feature 数组（含 height 属性，来自 geoProcessor）
   * @returns 包含所有网格的 Group（单位为米）
   */
  generate(
    roads: GeoJSON.Feature[],
    buildings: GeoJSON.Feature[]
  ): THREE.Group {
    const group = new THREE.Group();
    // 释放上一次生成的资源（防止重复调用泄漏）
    if (this.group) this.dispose();

    const origin = this.origin ?? this.computeOrigin(roads, buildings);

    // 建筑：分组 → ExtrudeGeometry → InstancedMesh
    const buildingGroups = this.collectBuildingGroups(buildings, origin);
    for (const bg of buildingGroups) {
      this.addBuildingGroup(group, bg);
    }

    // 道路：ribbon 顶点合并到单一 BufferGeometry
    const roadGeometry = this.buildRoadGeometry(roads, origin);
    if (roadGeometry) {
      const roadMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0,
      });
      group.add(new THREE.Mesh(roadGeometry, roadMaterial));
    }

    this.group = group;
    return group;
  }

  /**
   * 释放所有已生成的几何体、材质与实例缓冲。
   * 调用后 Group 内不再持有任何资源。
   */
  dispose(): void {
    if (!this.group) return;
    disposeObject3D(this.group);
    this.group.clear();
    this.group = null;
  }

  // ---------------------------------------------------------------------------
  // 建筑
  // ---------------------------------------------------------------------------

  /** 遍历建筑，按（高度桶, 颜色）分组并投影到米制坐标 */
  private collectBuildingGroups(
    buildings: GeoJSON.Feature[],
    origin: [number, number]
  ): BuildingGroup[] {
    const groups = new Map<string, BuildingGroup>();

    for (const feature of buildings) {
      try {
        const ring = getOuterRingCoords(feature.geometry);
        if (!ring || ring.length < 4) continue;

        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const buildingType = getStringProp(props, "building") ?? "yes";

        // 高度：geoProcessor 已写入 height，此处防御性兜底
        const rawHeight = props["height"];
        const height =
          typeof rawHeight === "number" && rawHeight > 0
            ? rawHeight
            : FALLBACK_HEIGHT;

        const color =
          BUILDING_COLORS[buildingType] ?? FALLBACK_BUILDING_COLOR;
        const bucket = heightBucket(height);
        const key = `${bucket}|${color}`;

        // footprint → 米制 bbox
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [lon, lat] of ring) {
          const [x, y] = lonLatToLocalMeters(lon, lat, origin);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
        const width = maxX - minX;
        const depth = maxY - minY;
        if (width < 1e-6 || depth < 1e-6) continue; // 退化 footprint

        let group = groups.get(key);
        if (!group) {
          group = { key, height: bucket, color, entries: [] };
          groups.set(key, group);
        }
        group.entries.push({
          position: new THREE.Vector3(
            (minX + maxX) / 2,
            (minY + maxY) / 2,
            0
          ),
          scale: new THREE.Vector3(width, depth, height),
          rotationZ: footprintRotationZ(ring),
        });
      } catch (error) {
        console.warn(
          "跳过无效建筑：",
          error instanceof Error ? error.message : error
        );
      }
    }

    return [...groups.values()];
  }

  /** 为一个建筑分组创建（可能多个）InstancedMesh 并加入 Group */
  private addBuildingGroup(group: THREE.Group, bg: BuildingGroup): void {
    // 单位矩形 Shape → ExtrudeGeometry（bevelSegments=0，底在 z=0，顶在 z=1）
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: UNIT_EXTRUDE_DEPTH,
      bevelEnabled: false, // bevelSegments = 0
    });
    const material = new THREE.MeshStandardMaterial({
      color: bg.color,
      roughness: 0.85,
      metalness: 0.05,
    });

    // 超过 50k 拆分为多个 InstancedMesh（共享同一几何体与材质）
    for (let start = 0; start < bg.entries.length; start += MAX_INSTANCES_PER_BATCH) {
      const chunk = bg.entries.slice(start, start + MAX_INSTANCES_PER_BATCH);
      const mesh = new THREE.InstancedMesh(geometry, material, chunk.length);

      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      chunk.forEach((entry, i) => {
        quaternion.setFromAxisAngle(Z_AXIS, entry.rotationZ);
        matrix.compose(entry.position, quaternion, entry.scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;

      group.add(mesh);
    }
  }

  // ---------------------------------------------------------------------------
  // 道路
  // ---------------------------------------------------------------------------

  /**
   * 将所有道路折线展开为带状三角形，顶点合并进一个 BufferGeometry。
   *
   * 每条线段生成 2 个三角形（6 个顶点，non-indexed）：
   * 左右两侧顶点沿法线方向偏移 halfWidth，UV.u 沿路累计距离，
   * UV.v 横向（0=左，1=右），顶点色按 highway 类型区分。
   */
  private buildRoadGeometry(
    roads: GeoJSON.Feature[],
    origin: [number, number]
  ): THREE.BufferGeometry | null {
    // 第一遍：统计总段数，预分配数组避免反复扩容
    let totalSegments = 0;
    const lineArrays: [number, number][][] = [];
    const lineWidths: number[] = [];
    const lineColors: string[] = [];

    for (const feature of roads) {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const highway = getStringProp(props, "highway") ?? "unclassified";
      const color = ROAD_COLORS[highway] ?? FALLBACK_ROAD_COLOR;
      const rawWidth = props["width"];
      const width =
        typeof rawWidth === "number" && rawWidth > 0
          ? rawWidth
          : FALLBACK_WIDTH;

      const lines = this.extractLineCoords(feature.geometry);
      for (const line of lines) {
        if (line.length < 2) continue;
        lineArrays.push(line);
        lineWidths.push(width);
        lineColors.push(color);
        totalSegments += line.length - 1;
      }
    }

    if (totalSegments === 0) return null;

    // 每段 6 顶点 × 3 分量
    const positions = new Float32Array(totalSegments * 6 * 3);
    const colors = new Float32Array(totalSegments * 6 * 3);
    const uvs = new Float32Array(totalSegments * 6 * 2);

    let vertexOffset = 0;
    let segmentIndex = 0;

    for (let li = 0; li < lineArrays.length; li++) {
      const line = lineArrays[li];
      const halfWidth = lineWidths[li] / 2;
      const [r, g, b] = hexToRgb(lineColors[li]);

      // 投影到米制坐标
      const pts = line.map(([lon, lat]) =>
        lonLatToLocalMeters(lon, lat, origin)
      );

      // 累计弧长（用于 UV.u）
      const cumDist: number[] = [0];
      for (let i = 1; i < pts.length; i++) {
        cumDist.push(
          cumDist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        );
      }

      for (let i = 0; i < pts.length - 1; i++) {
        const [nxL, nyL] = vertexNormal(pts, i);
        const [nxR, nyR] = vertexNormal(pts, i + 1);

        // 当前段左右两侧端点
        const ax = pts[i][0] + nxL * halfWidth;
        const ay = pts[i][1] + nyL * halfWidth;
        const bx = pts[i][0] - nxL * halfWidth;
        const by = pts[i][1] - nyL * halfWidth;
        const cx = pts[i + 1][0] + nxR * halfWidth;
        const cy = pts[i + 1][1] + nyR * halfWidth;
        const dx = pts[i + 1][0] - nxR * halfWidth;
        const dy = pts[i + 1][1] - nyR * halfWidth;

        const u0 = cumDist[i] * ROAD_UV_SCALE_PER_METER;
        const u1 = cumDist[i + 1] * ROAD_UV_SCALE_PER_METER;

        // 三角形 1：(a, b, d)  三角形 2：(a, d, c)
        const triVerts: [number, number, number, number, number][] = [
          [ax, ay, u0, 0, 0],
          [bx, by, u0, 1, 0],
          [dx, dy, u1, 1, 0],
          [ax, ay, u0, 0, 0],
          [dx, dy, u1, 1, 0],
          [cx, cy, u1, 0, 0],
        ];

        for (const [vx, vy, u, v, _pad] of triVerts) {
          const p = vertexOffset * 3;
          const t = vertexOffset * 2;
          positions[p] = vx;
          positions[p + 1] = vy;
          positions[p + 2] = 0;
          colors[p] = r;
          colors[p + 1] = g;
          colors[p + 2] = b;
          uvs[t] = u;
          uvs[t + 1] = v;
          vertexOffset++;
        }
        segmentIndex++;
      }
    }

    if (vertexOffset === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    return geometry;
  }

  /** 从 LineString / MultiLineString 几何中提取坐标线 */
  private extractLineCoords(
    geometry: GeoJSON.Geometry
  ): [number, number][][] {
    if (geometry.type === "LineString") {
      return [geometry.coordinates as [number, number][]];
    }
    if (geometry.type === "MultiLineString") {
      return geometry.coordinates as [number, number][][];
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // 原点
  // ---------------------------------------------------------------------------

  /** 从全部数据的外包矩形中心计算投影原点 */
  private computeOrigin(
    roads: GeoJSON.Feature[],
    buildings: GeoJSON.Feature[]
  ): [number, number] {
    return computeBBoxCenter([...roads, ...buildings]);
  }
}