import osmtogeojson from "osmtogeojson";
import {
  OVERPASS_API_URL,
  OVERPASS_TIMEOUT,
} from "@/utils/constants";

/** 主线程内联转换的响应体大小上限（字节）。超过则交给 Web Worker，防主线程阻塞。 */
const MAX_INLINE_CONVERSION_BYTES = 5 * 1024 * 1024;

/** Overpass HTTP 错误（携带状态码，用于判断是否可重试） */
export class OverpassHttpError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Overpass API request failed: ${status} ${statusText}`);
    this.name = "OverpassHttpError";
    this.status = status;
  }
}

/** fetchOSMData 的可选参数 */
export interface FetchOSMOptions {
  /** 额外重试次数（默认 3，总尝试 = retries + 1） */
  retries?: number;
  /** 指数退避基数毫秒（默认 1000） */
  baseBackoffMs?: number;
  /** 退避上限毫秒（默认 8000） */
  maxBackoffMs?: number;
}

/**
 * 判断响应体是否需要交给 Web Worker 转换。
 *
 * @param bytesLength - 响应体文本的字节长度
 */
export function shouldUseWorker(bytesLength: number): boolean {
  return bytesLength > MAX_INLINE_CONVERSION_BYTES;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 判断错误是否值得重试：网络失败或 429/5xx 服务端/限流错误 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof OverpassHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  // fetch 网络层失败（TypeError: Failed to fetch）
  return error instanceof TypeError;
}

/**
 * 构建 Overpass QL 查询。
 *
 * 查询结构：
 *   [out:json]       — 返回 JSON
 *   [timeout:N]      — 服务端超时（秒）
 *   (way["highway"](bbox); way["building"](bbox);) — highway 与 building 道路/建筑并集
 *   out body         — 输出要素本体（tags + 节点引用）
 *   >;               — 递归下钻获取被引用的节点
 *   out skel qt      — 按四叉树顺序输出节点骨架（高效）
 *
 * @param bbox - [south, west, north, east]
 */
function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [south, west, north, east] = bbox;
  return `[out:json][timeout:${OVERPASS_TIMEOUT}];(way["highway"](${south},${west},${north},${east});way["building"](${south},${west},${north},${east}););out body;>;out skel qt;`;
}

/**
 * 将原始 OSM JSON 转换为 GeoJSON FeatureCollection。
 *
 * @param osmData - Overpass 响应解析后的 JSON
 * @param useWorker - 为 true 时在 Web Worker 中转换（大数据）
 */
export async function convertOSMToGeoJSON(
  osmData: unknown,
  useWorker = false
): Promise<GeoJSON.FeatureCollection> {
  if (useWorker) return convertInWorker(osmData);

  try {
    return osmtogeojson(osmData) as GeoJSON.FeatureCollection;
  } catch (error) {
    throw new Error(
      `Failed to convert OSM data to GeoJSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** 在 Web Worker 中执行 osmtogeojson 转换 */
function convertInWorker(
  osmData: unknown
): Promise<GeoJSON.FeatureCollection> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(
        new URL("./osmWorker.ts", import.meta.url),
        { type: "module" }
      );

      worker.onmessage = (e: MessageEvent) => {
        worker.terminate();
        const data = e.data as GeoJSON.FeatureCollection | { __error?: string };
        if (
          data &&
          typeof data === "object" &&
          "__error" in data &&
          typeof data.__error === "string"
        ) {
          reject(new Error(`OSM 转换 Worker 失败: ${data.__error}`));
          return;
        }
        resolve(data as GeoJSON.FeatureCollection);
      };

      worker.onerror = (e: ErrorEvent) => {
        worker.terminate();
        reject(new Error(`OSM 转换 Worker 错误: ${e.message}`));
      };

      worker.postMessage(osmData);
    } catch (error) {
      // Worker 不可用（如部分环境）时降级到主线程转换
      reject(
        new Error(
          `无法启动 OSM 转换 Worker，已降级: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }
  });
}

/**
 * 获取指定边界框内的 OSM 道路与建筑数据，转换为 GeoJSON。
 *
 * - 网络失败与限流（429/5xx）按指数退避自动重试
 * - 响应体 > 5MB 时在 Web Worker 中转换，避免阻塞主线程
 * - Overpass 无数据时返回空 FeatureCollection（不抛错）
 *
 * @param bbox - [south, west, north, east]
 * @param options - 重试策略
 * @throws OverpassHttpError（非可重试状态码）或最后一次重试的错误
 */
export async function fetchOSMData(
  bbox: [number, number, number, number],
  options: FetchOSMOptions = {}
): Promise<GeoJSON.FeatureCollection> {
  const {
    retries = 3,
    baseBackoffMs = 1000,
    maxBackoffMs = 8000,
  } = options;

  const query = buildOverpassQuery(bbox);

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(OVERPASS_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!response.ok) {
        throw new OverpassHttpError(response.status, response.statusText);
      }

      // 读取文本以判断体积，同时避免 json() 二次解析
      const text = await response.text();
      const osmData = JSON.parse(text) as unknown;

      return await convertOSMToGeoJSON(osmData, shouldUseWorker(text.length));
    } catch (error) {
      lastError = error;

      const retryable = isRetryableError(error);
      if (!retryable || attempt === retries) {
        // JSON 解析错误等非可重试错误直接抛出
        if (error instanceof SyntaxError) {
          throw new Error("Failed to parse Overpass API response as JSON");
        }
        throw error;
      }

      const delay = Math.min(baseBackoffMs * 2 ** attempt, maxBackoffMs);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OSM 数据获取失败");
}