import UPNG from "upng-js";
import { browserCanvasFactory, type CanvasFactory } from "@/utils/canvas";
import { writeGrayscale16ToCanvas } from "@/utils/imageExporter";

// =============================================================================
// DEM（数字高程模型）服务
//
// 数据源：AWS Terrain Tiles（terrarium 编码），无需 API token：
//   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
//   海拔(米) = R*256 + G + B/256 - 32768
// 瓦片为 Web Mercator 256×256 PNG。
//
// 简化说明：拼接后的 DEM 栅格在城区尺度（< 20km）按经纬度线性近似，
// 忽略瓦片内墨卡托纬度非线性（误差 < 0.1%），换取可预测的重采样行为。
// =============================================================================

/** AWS Terrarium 瓦片边长（像素） */
const TERRARIUM_TILE_SIZE = 256;

/** AWS Terrain Tiles 端点 */
const AWS_TERRAIN_BASE =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** 数字高程模型：规整海拔栅格（米） */
export interface DEMData {
  /** 栅格宽度（像素） */
  width: number;
  /** 栅格高度（像素） */
  height: number;
  /** 海拔数组（米），行主序，长度 width × height */
  elevations: Float32Array;
  /** 栅格覆盖范围 [south, west, north, east]（瓦片对齐，可能略大于请求 bbox） */
  bbox: [number, number, number, number];
}

// ---------------------------------------------------------------------------
// 瓦片坐标（Web Mercator）
// ---------------------------------------------------------------------------

function lonToTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2;
  return Math.floor(y * 2 ** zoom);
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// ---------------------------------------------------------------------------
// 瓦片解码
// ---------------------------------------------------------------------------

/**
 * 解码单张 terrarium 瓦片 PNG 为海拔栅格。
 *
 * terrarium 编码：elevation = R*256 + G + B/256 - 32768（米）。
 *
 * @param png - 瓦片 PNG 字节
 */
export async function decodeTerrariumTile(
  png: ArrayBuffer
): Promise<{
  elevations: Float32Array;
  width: number;
  height: number;
}> {
  const image = UPNG.decode(png);
  const { width, height } = image;
  // @types/upng-js 将 data 声明为 ArrayBuffer，运行时实为 Uint8Array(RGBA)
  const data = image.data as unknown as Uint8Array;
  const elevations = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    elevations[i] = r * 256 + g + b / 256 - 32768;
  }
  return { elevations, width, height };
}

// ---------------------------------------------------------------------------
// Zoom 选择
// ---------------------------------------------------------------------------

/**
 * 为 bbox 选择瓦片 zoom：瓦片覆盖数不超过 maxTiles 的最大 zoom。
 *
 * 从 z=18 向下搜索，返回瓦片数量 ≤ maxTiles 的最高层级
 * （越大越精细，但瓦片数受上限约束）。
 *
 * @param bbox - [south, west, north, east]
 * @param maxTiles - 瓦片数量上限（默认 64）
 */
export function pickZoomLevel(
  bbox: [number, number, number, number],
  maxTiles = 64
): number {
  const [south, west, north, east] = bbox;
  for (let z = 18; z >= 6; z--) {
    const nx = Math.max(1, Math.ceil(((east - west) / 360) * 2 ** z));
    const ny = Math.max(1, Math.ceil(((north - south) / 180) * 2 ** z));
    if (nx * ny <= maxTiles) return z;
  }
  return 18;
}

// ---------------------------------------------------------------------------
// 数据获取
// ---------------------------------------------------------------------------

/**
 * 结合目标分辨率选择 zoom：在瓦片数上限内，尽量让每轴瓦片数
 * 达到 ceil(resolution / 256)；无法满足时降级为 pickZoomLevel。
 */
export function pickZoomForResolution(
  bbox: [number, number, number, number],
  resolution: number,
  maxTiles = 64
): number {
  const [south, west, north, east] = bbox;
  const minPerAxis = Math.max(1, Math.ceil(resolution / TERRARIUM_TILE_SIZE));
  for (let z = 18; z >= 6; z--) {
    const nx = Math.max(1, Math.ceil(((east - west) / 360) * 2 ** z));
    const ny = Math.max(1, Math.ceil(((north - south) / 180) * 2 ** z));
    if (nx * ny <= maxTiles && nx >= minPerAxis && ny >= minPerAxis) {
      return z;
    }
  }
  return pickZoomLevel(bbox, maxTiles);
}

/**
 * 获取 bbox 对应的 DEM 栅格：请求覆盖 bbox 的全部 terrarium 瓦片并拼接。
 *
 * 返回栅格范围为瓦片对齐的外包矩形（可能略大于 bbox），
 * 实际裁剪在 generateHeightmap 中按 bbox 完成。
 *
 * @param bbox - [south, west, north, east]
 * @param resolution - 目标高度图分辨率（用于参考，默认 1081）
 * @param maxTiles - 瓦片数量上限
 * @throws 任一瓦片请求失败时抛出错误
 */
export async function fetchDEMData(
  bbox: [number, number, number, number],
  resolution = 1081,
  maxTiles = 64
): Promise<DEMData> {
  const zoom = pickZoomForResolution(bbox, resolution, maxTiles);
  const [south, west, north, east] = bbox;

  const x0 = lonToTileX(west, zoom);
  const x1 = lonToTileX(east, zoom);
  const y0 = latToTileY(north, zoom);
  const y1 = latToTileY(south, zoom);
  const tilesX = x1 - x0 + 1;
  const tilesY = y1 - y0 + 1;

  // 并行请求全部瓦片
  const urls: string[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      urls.push(`${AWS_TERRAIN_BASE}/${zoom}/${tx}/${ty}.png`);
    }
  }

  const decoded = await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `DEM 瓦片请求失败: ${url} (${response.status} ${response.statusText})`
        );
      }
      const png = await response.arrayBuffer();
      return decodeTerrariumTile(png);
    })
  );

  // 拼接为完整栅格
  const gridWidth = tilesX * TERRARIUM_TILE_SIZE;
  const gridHeight = tilesY * TERRARIUM_TILE_SIZE;
  const elevations = new Float32Array(gridWidth * gridHeight);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = decoded[ty * tilesX + tx];
      const dstX = tx * TERRARIUM_TILE_SIZE;
      const dstY = ty * TERRARIUM_TILE_SIZE;
      for (let py = 0; py < TERRARIUM_TILE_SIZE; py++) {
        const srcRow = py * TERRARIUM_TILE_SIZE;
        const dstRow = (dstY + py) * gridWidth;
        elevations.set(
          tile.elevations.subarray(srcRow, srcRow + TERRARIUM_TILE_SIZE),
          dstRow + dstX
        );
      }
    }
  }

  // 栅格外包范围（瓦片对齐）
  const demWest = (x0 / 2 ** zoom) * 360 - 180;
  const demEast = ((x1 + 1) / 2 ** zoom) * 360 - 180;
  const demNorth = tileYToLat(y0, zoom);
  const demSouth = tileYToLat(y1 + 1, zoom);

  return {
    width: gridWidth,
    height: gridHeight,
    elevations,
    bbox: [demSouth, demWest, demNorth, demEast],
  };
}

// ---------------------------------------------------------------------------
// 高度图生成
// ---------------------------------------------------------------------------

/**
 * 双线性采样 DEM 栅格（越界时 clamp 到边缘）。
 * 供高度图生成与道路网络高度赋值共用。
 *
 * cellLon/cellLat 可省略——缺省时按栅格外包范围与分辨率自动计算。
 */
export function sampleDEM(
  dem: DEMData,
  lon: number,
  lat: number,
  cellLon?: number,
  cellLat?: number
): number {
  const clon =
    cellLon ?? (dem.bbox[3] - dem.bbox[1]) / Math.max(1, dem.width - 1);
  const clat =
    cellLat ?? (dem.bbox[2] - dem.bbox[0]) / Math.max(1, dem.height - 1);
  const gx = (lon - dem.bbox[1]) / clon;
  const gy = (dem.bbox[2] - lat) / clat; // 纬度向下增长
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;

  const i0 = Math.min(Math.max(y0, 0), dem.height - 1);
  const i1 = Math.min(Math.max(y0 + 1, 0), dem.height - 1);
  const j0 = Math.min(Math.max(x0, 0), dem.width - 1);
  const j1 = Math.min(Math.max(x0 + 1, 0), dem.width - 1);

  const v00 = dem.elevations[i0 * dem.width + j0];
  const v10 = dem.elevations[i0 * dem.width + j1];
  const v01 = dem.elevations[i1 * dem.width + j0];
  const v11 = dem.elevations[i1 * dem.width + j1];

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * 将 DEM 重采样到 bbox 内的 resolution×resolution 高度图，
 * 海拔按 bbox 内 min/max 线性映射到 16 位灰度（0=最低，65535=最高），
 * 写入 canvas 的 R/G 通道（高/低字节）。
 *
 * @param demData - fetchDEMData 的产物（覆盖范围须包含 bbox）
 * @param bbox - 目标区域 [south, west, north, east]
 * @param resolution - 输出边长（默认 1081，Cities: Skylines 标准）
 * @param canvasFactory - canvas 工厂（默认浏览器 document）
 * @returns 编码后的 canvas
 */
export function generateHeightmap(
  demData: DEMData,
  bbox: [number, number, number, number],
  resolution = 1081,
  canvasFactory: CanvasFactory = browserCanvasFactory
): HTMLCanvasElement {
  const [south, west, north, east] = bbox;

  // DEM 单元大小（度）。单行/单列时退化为跨度。
  const cellLon =
    (demData.bbox[3] - demData.bbox[1]) / Math.max(1, demData.width - 1);
  const cellLat =
    (demData.bbox[2] - demData.bbox[0]) / Math.max(1, demData.height - 1);

  // 第一遍：采样并统计 min/max
  const sampled = new Float32Array(resolution * resolution);
  let min = Infinity;
  let max = -Infinity;
  for (let py = 0; py < resolution; py++) {
    const lat = north - ((north - south) * py) / (resolution - 1);
    for (let px = 0; px < resolution; px++) {
      const lon = west + ((east - west) * px) / (resolution - 1);
      const value = sampleDEM(demData, lon, lat, cellLon, cellLat);
      sampled[py * resolution + px] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  // 第二遍：min→0，max→65535 线性映射
  const range = max - min;
  const values = new Uint16Array(resolution * resolution);
  for (let i = 0; i < sampled.length; i++) {
    values[i] =
      range <= 0 ? 0 : Math.round(((sampled[i] - min) / range) * 65535);
  }

  const canvas = canvasFactory();
  canvas.width = resolution;
  canvas.height = resolution;
  writeGrayscale16ToCanvas(canvas, values, resolution, resolution);
  return canvas;
}