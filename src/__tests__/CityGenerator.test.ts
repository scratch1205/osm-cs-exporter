import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import {
  CityGenerator,
  lonLatToLocalMeters,
  MAX_INSTANCES_PER_BATCH,
} from "../engine/CityGenerator";

/** 赤道附近每度约 111320 米（测试数据都放在赤道附近以便计算） */
const M_PER_DEG = 111_320;

/**
 * 构造一个矩形 footprint 的建筑 Feature（模拟 geoProcessor 输出）。
 * bbox 以 (lon, lat) 为中心，宽深由米制换算为度。
 */
function makeBuildingFeature(
  lon: number,
  lat: number,
  widthM: number,
  depthM: number,
  heightM: number,
  building = "yes"
): GeoJSON.Feature {
  const w = widthM / M_PER_DEG;
  const d = depthM / M_PER_DEG;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon - w / 2, lat - d / 2],
          [lon + w / 2, lat - d / 2],
          [lon + w / 2, lat + d / 2],
          [lon - w / 2, lat + d / 2],
          [lon - w / 2, lat - d / 2],
        ],
      ],
    },
    properties: { building, height: heightM },
  };
}

/** 构造一条道路 Feature（模拟 geoProcessor 输出）。 */
function makeRoadFeature(
  coords: [number, number][],
  highway = "residential",
  width?: number
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: { highway, ...(width !== undefined ? { width } : {}) },
  };
}

describe("lonLatToLocalMeters", () => {
  it("将经纬度投影为相对原点的米制坐标", () => {
    // 原点 (0,0)：0.0001 度经度 ≈ 11.13 米，纬度相同
    const [x, y] = lonLatToLocalMeters(0.0001, 0.0001, [0, 0]);
    expect(x).toBeCloseTo(11.13, 0);
    expect(y).toBeCloseTo(11.13, 0);
  });

  it("在非赤道纬度上对经度做 cos 校正", () => {
    const lat = 39.9; // 北京纬度
    const [x] = lonLatToLocalMeters(0.001, 0, [0, lat]);
    // 111320 * cos(39.9°) ≈ 85420
    expect(x).toBeCloseTo(85.4, 0);
  });
});

describe("CityGenerator", () => {
  let generator: CityGenerator;

  beforeEach(() => {
    generator = new CityGenerator();
  });

  it("generate 返回单个 THREE.Group", () => {
    const group = generator.generate([], []);
    expect(group).toBeInstanceOf(THREE.Group);
  });

  it("空输入时 Group 不含任何子节点", () => {
    const group = generator.generate([], []);
    expect(group.children).toHaveLength(0);
  });

  describe("建筑生成", () => {
    it("相同高度与颜色的建筑合并到同一个 InstancedMesh", () => {
      const buildings = [
        makeBuildingFeature(0.00005, 0.00005, 10, 10, 10),
        makeBuildingFeature(0.00008, 0.00008, 12, 14, 11), // 11m 与 10m 同属一个 3m 高度桶
      ];
      const group = generator.generate([], buildings);

      const instanced = group.children.filter(
        (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh
      );
      expect(instanced).toHaveLength(1);
      expect(instanced[0].count).toBe(2);
    });

    it("不同高度桶的建筑分到不同 InstancedMesh", () => {
      const buildings = [
        makeBuildingFeature(0.00005, 0.00005, 10, 10, 10),
        makeBuildingFeature(0.00008, 0.00008, 10, 10, 30), // 30m 属于不同高度桶
      ];
      const group = generator.generate([], buildings);

      const instanced = group.children.filter(
        (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh
      );
      expect(instanced).toHaveLength(2);
    });

    it("每个实例的 matrix 使用米制位置与真实高度缩放", () => {
      const gen = new CityGenerator({ origin: [0, 0] });
      const building = makeBuildingFeature(0.0001, 0, 10, 10, 25);
      const group = gen.generate([], [building]);

      const instanced = group.children.find(
        (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh
      )!;
      expect(instanced).toBeDefined();

      const matrix = new THREE.Matrix4();
      instanced.getMatrixAt(0, matrix);
      const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);

      // 建筑中心 (0.0001, 0) → 米制 x ≈ 11.13，y ≈ 0
      expect(pos.x).toBeCloseTo(11.13, 0);
      expect(Math.abs(pos.y)).toBeLessThan(0.5);
      // 高度经 scale.z 表达
      expect(scale.z).toBeCloseTo(25, 0);
    });

    it("超过 50k 实例时拆分到多个 InstancedMesh", () => {
      const buildings: GeoJSON.Feature[] = [];
      for (let i = 0; i < MAX_INSTANCES_PER_BATCH + 1; i++) {
        const lon = 0.00001 + i * 1e-7;
        buildings.push(makeBuildingFeature(lon, 0.00001, 8, 8, 10));
      }
      const group = generator.generate([], buildings);

      const instanced = group.children.filter(
        (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh
      );
      expect(instanced).toHaveLength(2);
      expect(instanced[0].count).toBe(MAX_INSTANCES_PER_BATCH);
      expect(instanced[1].count).toBe(1);
    });

    it("使用 MeshStandardMaterial 且按颜色分组", () => {
      const buildings = [
        makeBuildingFeature(0.00005, 0.00005, 10, 10, 10, "residential"),
        makeBuildingFeature(0.00008, 0.00008, 10, 10, 10, "industrial"),
      ];
      const group = generator.generate([], buildings);

      const instanced = group.children.filter(
        (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh
      );
      expect(instanced).toHaveLength(2);
      for (const mesh of instanced) {
        expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      }
    });
  });

  describe("道路生成", () => {
    it("折线生成 ribbon BufferGeometry，顶点数为段数 × 6", () => {
      // 3 个点 = 2 段，每段 2 个三角形 = 6 个顶点
      const road = makeRoadFeature([
        [0, 0],
        [0.0001, 0],
        [0.0002, 0],
      ]);
      const group = generator.generate([road], []);

      const roadMesh = group.children.find(
        (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
      ) as THREE.Mesh | undefined;

      expect(roadMesh).toBeDefined();
      const positions = roadMesh!.geometry.getAttribute("position");
      expect(positions.count).toBe(12);
    });

    it("道路宽度来自 feature properties，单位为米", () => {
      const gen = new CityGenerator({ origin: [0, 0] });
      // 沿经度方向（x）延伸的道路，宽度 8m → 顶点 y 范围 ≈ ±4m
      const road = makeRoadFeature(
        [
          [0.0001, 0],
          [0.0003, 0],
        ],
        "residential",
        8
      );
      const group = gen.generate([road], []);
      const roadMesh = group.children.find(
        (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
      ) as THREE.Mesh;

      const positions = roadMesh.geometry.getAttribute("position");
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        minY = Math.min(minY, positions.getY(i));
        maxY = Math.max(maxY, positions.getY(i));
      }
      expect(minY).toBeCloseTo(-4, 0);
      expect(maxY).toBeCloseTo(4, 0);
    });

    it("道路 geometry 包含颜色与 UV 属性", () => {
      const road = makeRoadFeature([
        [0, 0],
        [0.0001, 0],
      ]);
      const group = generator.generate([road], []);

      const roadMesh = group.children.find(
        (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
      ) as THREE.Mesh;

      expect(roadMesh.geometry.getAttribute("color")).toBeDefined();
      expect(roadMesh.geometry.getAttribute("uv")).toBeDefined();
    });

    it("道路使用带 vertexColors 的 MeshStandardMaterial", () => {
      const road = makeRoadFeature([
        [0, 0],
        [0.0001, 0],
      ]);
      const group = generator.generate([road], []);
      const roadMesh = group.children.find(
        (c) => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)
      ) as THREE.Mesh;

      const material = roadMesh.material as THREE.MeshStandardMaterial;
      expect(material.vertexColors).toBe(true);
    });
  });

  describe("资源释放", () => {
    it("dispose 释放所有几何体与材质", () => {
      const buildings = [makeBuildingFeature(0.00005, 0.00005, 10, 10, 10)];
      const roads = [
        makeRoadFeature([
          [0, 0],
          [0.0001, 0],
        ]),
      ];
      const group = generator.generate(roads, buildings);

      const geometries: THREE.BufferGeometry[] = [];
      const materials: THREE.Material[] = [];
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) geometries.push(mesh.geometry);
        if (mesh.material) materials.push(mesh.material as THREE.Material);
      });
      expect(geometries.length).toBeGreaterThan(0);

      const geomSpies = geometries.map((g) => vi.spyOn(g, "dispose"));
      const matSpies = materials.map((m) => vi.spyOn(m, "dispose"));

      generator.dispose();

      geomSpies.forEach((s) => expect(s).toHaveBeenCalled());
      matSpies.forEach((s) => expect(s).toHaveBeenCalled());
    });
  });
});