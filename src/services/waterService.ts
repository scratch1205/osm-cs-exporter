import { browserCanvasFactory, type CanvasFactory } from "@/utils/canvas";
import { traceRingsPath } from "@/utils/geo";

/**
 * 水面要素的 OSM 标签判定：
 *   natural=water       — 湖泊、水库、海洋等自然水体（面）
 *   waterway=riverbank  — 河流两岸之间的水面（面）
 */
function isWaterFeature(feature: GeoJSON.Feature): boolean {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  return props["natural"] === "water" || props["waterway"] === "riverbank";
}

/**
 * 生成水掩膜：白 = 水面，黑 = 陆地。
 *
 * 从 OSM GeoJSON 提取 natural=water 与 waterway=riverbank 面要素，
 * 投影到 bbox 对应的 canvas 并填充白色（evenodd 规则支持带洞水面），
 * 背景为黑色（陆地）。
 *
 * @param osmGeoJSON - osmtogeojson 转换后的 GeoJSON（含自然水体/河流标签）
 * @param bbox - 目标区域 [south, west, north, east]
 * @param resolution - 输出边长（默认 1081）
 * @param canvasFactory - canvas 工厂（默认浏览器 document）
 * @returns 水掩膜 canvas（黑=陆地，白=水面）
 */
export function generateWaterMask(
  osmGeoJSON: GeoJSON.FeatureCollection,
  bbox: [number, number, number, number],
  resolution = 1081,
  canvasFactory: CanvasFactory = browserCanvasFactory
): HTMLCanvasElement {
  const canvas = canvasFactory();
  canvas.width = resolution;
  canvas.height = resolution;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 canvas 2D 上下文");

  // 背景：黑（陆地）
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, resolution, resolution);

  // 前景：白（水面）
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  let hasWater = false;
  for (const feature of osmGeoJSON.features) {
    if (!isWaterFeature(feature)) continue;
    const geometry = feature.geometry;
    if (geometry.type === "Polygon") {
      traceRingsPath(ctx, geometry.coordinates, bbox, resolution);
      hasWater = true;
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        traceRingsPath(ctx, polygon, bbox, resolution);
      }
      hasWater = true;
    }
  }
  if (hasWater) {
    ctx.fill("evenodd");
  }

  return canvas;
}