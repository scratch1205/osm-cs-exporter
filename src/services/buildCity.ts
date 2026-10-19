import { fetchOSMData } from "@/services/osmService";
import { filterAndSimplify } from "@/utils/geoProcessor";
import { CityGenerator } from "@/engine/CityGenerator";
import type * as THREE from "three";

/** 选区中没有可生成的道路或建筑数据 */
export class CityDataEmptyError extends Error {
  constructor() {
    super("所选区域未找到 OSM 道路或建筑数据，请换一个区域重试");
    this.name = "CityDataEmptyError";
  }
}

/**
 * 完整城市生成管道：获取 → 过滤简化 → 生成 3D Group。
 *
 * 1. 通过 Overpass API 获取 bbox 内道路与建筑（自动重试 + 大响应走 Worker）
 * 2. 过滤无关要素、简化几何、补全高度/宽度
 * 3. 用 CityGenerator 生成 InstancedMesh 城市网格（米制坐标）
 *
 * @param bbox - [south, west, north, east]
 * @returns 包含全部 3D 网格的 Group；无数据时抛 CityDataEmptyError
 */
export async function buildCity(
  bbox: [number, number, number, number]
): Promise<THREE.Group> {
  const collection = await fetchOSMData(bbox);

  const { roads, buildings } = filterAndSimplify(collection);
  if (roads.length === 0 && buildings.length === 0) {
    throw new CityDataEmptyError();
  }

  const generator = new CityGenerator();
  return generator.generate(roads, buildings);
}