import { browserCanvasFactory, type CanvasFactory } from "@/utils/canvas";
import { traceRingsPath } from "@/utils/geo";

/**
 * 树木密度掩膜服务。
 *
 * 从 OSM GeoJSON 提取植被要素，按类型分配灰度强度，
 * 输出「黑=无树、灰=稀疏、白=密林」的密度图。
 * 与 waterService 相同的 canvas 工厂注入模式。
 */

/** 植被标签键类型 */
export type VegetationTag = "natural" | "landuse" | "leisure";

/** 标签 → 强度映射（`${tag}_${value}` → 0-255） */
export const VEGETATION_INTENSITY: Record<string, number> = {
  natural_wood: 255, // 天然林（密）
  landuse_forest: 230, // 人工林
  natural_scrub: 160, // 灌木
  leisure_park: 128, // 公园（疏）
};

/**
 * 查询标签组合对应的植被强度。
 *
 * @param tag - OSM 标签键
 * @param value - OSM 标签值
 * @returns 强度 0-255；非植被标签返回 null
 */
export function vegetationIntensityFor(
  tag: string,
  value: string
): number | null {
  return VEGETATION_INTENSITY[`${tag}_${value}`] ?? null;
}

/**
 * 生成树木密度掩膜：白=密林，灰=稀疏，黑=无树。
 *
 * 实现要点：
 * 1. 过滤 natural=wood / landuse=forest / natural=scrub / leisure=park 面要素
 * 2. 逐要素绘制到复用的临时 canvas，读取像素后与累积强度数组
 *    逐像素取最大值（保证重叠区域不被低强度类型覆盖）
 * 3. 全部处理完一次性写入输出 canvas（R=G=强度，16 位导出时
 *    像素值 = 强度×257，高字节即原强度，C:S 任意位深读取正确）
 *
 * 性能注：每个要素对全图执行一次 getImageData（1081² ≈ 4.7MB），
 * 城市尺度要素数量通常 < 100，一次性操作可接受；
 * 要素极多时可优化为只读取要素包围盒区域。
 *
 * @param osmGeoJSON - osmtogeojson 转换后的 GeoJSON
 * @param bbox - 目标区域 [south, west, north, east]
 * @param resolution - 输出边长（默认 1081）
 * @param canvasFactory - canvas 工厂（默认浏览器 document）
 * @returns 树木密度掩膜 canvas
 */
export function generateTreeMask(
  osmGeoJSON: GeoJSON.FeatureCollection,
  bbox: [number, number, number, number],
  resolution = 1081,
  canvasFactory: CanvasFactory = browserCanvasFactory
): HTMLCanvasElement {
  const canvas = canvasFactory();
  canvas.width = resolution;
  canvas.height = resolution;
  const outputCtx = canvas.getContext("2d");
  if (!outputCtx) throw new Error("无法获取 canvas 2D 上下文");

  // 累积强度数组（重叠取最大值）
  const intensity = new Uint8Array(resolution * resolution);

  // 复用的临时 canvas：逐要素清空重绘，避免每要素新建
  const scratchCanvas = canvasFactory();
  scratchCanvas.width = resolution;
  scratchCanvas.height = resolution;
  const scratchCtx = scratchCanvas.getContext("2d");
  if (!scratchCtx) throw new Error("无法获取 canvas 2D 上下文");

  for (const feature of osmGeoJSON.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;

    // 取该要素的植被强度（多标签时取第一个匹配）
    let featureIntensity: number | null = null;
    for (const [tag, value] of Object.entries(props)) {
      if (typeof value !== "string") continue;
      const intensityValue = vegetationIntensityFor(tag, value);
      if (intensityValue !== null) {
        featureIntensity = intensityValue;
        break;
      }
    }
    if (featureIntensity === null) continue;

    // 提取多边形坐标（Polygon / MultiPolygon）
    const geometry = feature.geometry;
    const polygons: GeoJSON.Position[][][] =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    if (polygons.length === 0) continue;

    // 临时 canvas 上绘制当前要素
    scratchCtx.fillStyle = "#000000";
    scratchCtx.fillRect(0, 0, resolution, resolution);
    scratchCtx.fillStyle = `rgb(${featureIntensity}, ${featureIntensity}, ${featureIntensity})`;
    scratchCtx.beginPath();
    for (const polygon of polygons) {
      traceRingsPath(scratchCtx, polygon, bbox, resolution);
    }
    scratchCtx.fill("evenodd");

    // 与累积数组逐像素取最大值（灰度 R 通道即强度）
    const image = scratchCtx.getImageData(0, 0, resolution, resolution);
    for (let i = 0; i < resolution * resolution; i++) {
      const v = image.data[i * 4];
      if (v > intensity[i]) intensity[i] = v;
    }
  }

  // 写回输出 canvas：R=G=强度（16 位导出高/低字节一致）
  const output = outputCtx.createImageData(resolution, resolution);
  for (let i = 0; i < resolution * resolution; i++) {
    const v = intensity[i];
    output.data[i * 4] = v;
    output.data[i * 4 + 1] = v;
    output.data[i * 4 + 2] = 0;
    output.data[i * 4 + 3] = 255;
  }
  outputCtx.putImageData(output, 0, 0);

  return canvas;
}