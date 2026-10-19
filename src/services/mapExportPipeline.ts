import { fetchOSMData } from "@/services/osmService";
import { fetchDEMData, generateHeightmap } from "@/services/terrainService";
import { generateWaterMask } from "@/services/waterService";
import { generateTreeMask } from "@/services/vegetationService";
import { processRoadNetwork } from "@/services/roadNetworkService";
import { exportCanvasAs16BitPNG } from "@/utils/imageExporter";
import { browserCanvasFactory, type CanvasFactory } from "@/utils/canvas";

/**
 * 网页端「导出全部文件」流水线：
 * 一个 bbox → 高度图 / 水掩膜 / 树掩膜 / 路网 JSON 四个 Blob，
 * 供 UI 一键打包为 C:S 导入 zip。
 */

/** 导出流水线的四个产物 */
export interface MapExportAssets {
  /** 16 位灰度高度图 PNG */
  heightmap: Blob;
  /** 水域掩膜 PNG（黑=陆地，白=水面） */
  waterMask: Blob;
  /** 树木密度掩膜 PNG（黑=无树，白=密林） */
  treeMask: Blob;
  /** 路网 JSON（RoadNetworkData） */
  roadNetwork: Blob;
}

/**
 * 为 bbox 生成全部 C:S 地图导出资产。
 *
 * 数据流：
 * 1. Overpass 获取 OSM 道路/水面/植被（自动重试 + 大响应 Worker 转换）
 * 2. AWS Terrarium 获取 DEM → 16 位灰度高度图
 * 3. 同一份 GeoJSON 分别光栅化为水掩膜、树掩膜
 * 4. OSM 道路 → 简化 → 米制坐标路网 JSON（高度取自 DEM）
 *
 * 说明：即使 OSM 无数据，高度图仍可导出（DEM 独立于 OSM）；
 * 水/树/路网为空时产出全黑掩膜与空 JSON，不抛错。
 *
 * @param bbox - [south, west, north, east]
 * @param options - 分辨率与 canvas 工厂
 * @throws Overpass / DEM 网络错误时抛错（由 UI 展示）
 */
export async function generateMapExportAssets(
  bbox: [number, number, number, number],
  resolution = 1081,
  canvasFactory: CanvasFactory = browserCanvasFactory
): Promise<MapExportAssets> {
  // 并行获取 OSM 与 DEM
  const [collection, dem] = await Promise.all([
    fetchOSMData(bbox),
    fetchDEMData(bbox, resolution),
  ]);

  // 三个掩膜走同一套 canvas 工厂（测试注入）
  const heightmapCanvas = generateHeightmap(
    dem,
    bbox,
    resolution,
    canvasFactory
  );
  const waterCanvas = generateWaterMask(
    collection,
    bbox,
    resolution,
    canvasFactory
  );
  const treeCanvas = generateTreeMask(
    collection,
    bbox,
    resolution,
    canvasFactory
  );

  // 路网：完整 GeoJSON 进 roadNetworkService（内部按 highway 过滤），
  // 节点高度从 DEM 采样
  const roadData = processRoadNetwork(collection, { dem });
  const roadNetworkBlob = new Blob([JSON.stringify(roadData, null, 2)], {
    type: "application/json",
  });

  return {
    heightmap: exportCanvasAs16BitPNG(heightmapCanvas),
    waterMask: exportCanvasAs16BitPNG(waterCanvas),
    treeMask: exportCanvasAs16BitPNG(treeCanvas),
    roadNetwork: roadNetworkBlob,
  };
}