import osmtogeojson from "osmtogeojson";

/**
 * Web Worker 入口：在后台线程将原始 OSM JSON 转换为 GeoJSON，
 * 避免大响应（> 5MB）阻塞主线程。
 *
 * 消息协议：
 *   in:  原始 OSM JSON（elements 数组）
 *   out: GeoJSON FeatureCollection；失败时 { __error: string }
 */

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (data: unknown) => void;
};

ctx.onmessage = (e: MessageEvent) => {
  try {
    const geojson = osmtogeojson(e.data);
    ctx.postMessage(geojson);
  } catch (err) {
    ctx.postMessage({
      __error: err instanceof Error ? err.message : String(err),
    });
  }
};