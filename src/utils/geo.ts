/**
 * 从绘图工具产出的面要素提取 [south, west, north, east] 边界框。
 *
 * @param feature - Polygon / MultiPolygon GeoJSON Feature
 * @returns [minLat, minLon, maxLat, maxLon]，非面要素或空坐标返回 null
 */
export function bboxFromFeature(
  feature: GeoJSON.Feature
): [number, number, number, number] | null {
  const geometry = feature.geometry;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return null;
  }

  const rings =
    geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.coordinates.flat();

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }

  if (!isFinite(minLon) || !isFinite(minLat)) return null;
  return [minLat, minLon, maxLat, maxLon];
}
// ---------------------------------------------------------------------------
// Canvas 光栅化工具（waterService / vegetationService 共用）
// ---------------------------------------------------------------------------

/**
 * 将经纬度映射到 canvas 像素坐标。
 * x：west→0，east→resolution；y：north→0，south→resolution。
 */
export function lonLatToPixel(
  lon: number,
  lat: number,
  bbox: [number, number, number, number],
  resolution: number
): [number, number] {
  const [south, west, north, east] = bbox;
  const x = ((lon - west) / (east - west)) * resolution;
  const y = ((north - lat) / (north - south)) * resolution;
  return [x, y];
}

/**
 * 将多边形坐标环（含外环+内环）追踪为 canvas 路径。
 * 配合 evenodd 填充规则可表达带洞多边形。
 */
export function traceRingsPath(
  ctx: CanvasRenderingContext2D,
  rings: GeoJSON.Position[][],
  bbox: [number, number, number, number],
  resolution: number
): void {
  for (const ring of rings) {
    if (ring.length === 0) continue;
    const [sx, sy] = lonLatToPixel(ring[0][0], ring[0][1], bbox, resolution);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = lonLatToPixel(ring[i][0], ring[i][1], bbox, resolution);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

// ---------------------------------------------------------------------------
// BBox / 中心计算
// ---------------------------------------------------------------------------

/**
 * 计算一组要素外包矩形的中心 [lon, lat]。
 * 无有效坐标时退回默认原点（北京）。
 */
export function computeBBoxCenter(
  features: GeoJSON.Feature[]
): [number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const visit = (geometry: GeoJSON.Geometry) => {
    if (geometry.type === "GeometryCollection") {
      geometry.geometries.forEach(visit);
      return;
    }
    const coords = (geometry as GeoJSON.LineString).coordinates;
    if (!Array.isArray(coords)) return;
    const walk = (c: unknown) => {
      if (typeof c === "number") return;
      const arr = c as unknown[];
      if (
        arr.length >= 2 &&
        typeof arr[0] === "number" &&
        typeof arr[1] === "number"
      ) {
        const lon = arr[0] as number;
        const lat = arr[1] as number;
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        return;
      }
      arr.forEach(walk);
    };
    walk(coords);
  };

  for (const feature of features) visit(feature.geometry);

  if (!isFinite(minLon) || !isFinite(minLat)) {
    return [116.3975, 39.9087]; // 北京
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}
