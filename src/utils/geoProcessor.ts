import * as turf from "@turf/turf";

/** Default height (meters) when no building height info is available */
const DEFAULT_BUILDING_HEIGHT = 10;

/** Default width (meters) when no road width info is available */
const DEFAULT_ROAD_WIDTH = 6;

/** Height per level (meters) for deriving height from building:levels */
const HEIGHT_PER_LEVEL = 3;

/** Width per lane (meters) for deriving width from lanes */
const WIDTH_PER_LANE = 3;

/** Simplification tolerance for @turf/turf simplify() */
const SIMPLIFY_TOLERANCE = 0.0001;

/**
 * Attempts to parse a string value as a number.
 * Strips common suffixes like "m", "km", "ft" before parsing.
 *
 * @param value - Raw string value from an OSM tag
 * @returns Parsed number, or NaN if the value cannot be parsed
 */
function parseNumericTag(value: string | undefined): number {
  if (!value) return NaN;
  // Strip trailing unit suffixes (e.g. "12.5 m", "40 ft")
  const cleaned = value.replace(/\s*(m|km|ft|meter|meters|metre|metres)\s*$/i, "").trim();
  return parseFloat(cleaned);
}

/**
 * Extracts building height in meters from feature properties.
 *
 * Resolution order:
 * 1. `height` tag (parsed as float, e.g. "15" → 15m)
 * 2. `building:levels` × 3m per level (e.g. "5" → 15m)
 * 3. Default: 10 meters
 *
 * @param properties - GeoJSON feature properties from osmtogeojson
 * @returns Height in meters
 */
function extractBuildingHeight(properties: Record<string, unknown>): number {
  // Try explicit height tag first
  const height = parseNumericTag(properties["height"] as string | undefined);
  if (!isNaN(height) && height > 0) return height;

  // Fall back to building:levels × per-level height
  const levels = parseInt(properties["building:levels"] as string, 10);
  if (!isNaN(levels) && levels > 0) return levels * HEIGHT_PER_LEVEL;

  return DEFAULT_BUILDING_HEIGHT;
}

/**
 * Extracts road width in meters from feature properties.
 *
 * Resolution order:
 * 1. `width` tag (parsed as float, e.g. "8.5" → 8.5m)
 * 2. `lanes` × 3m per lane (e.g. "2" → 6m)
 * 3. Default: 6 meters
 *
 * @param properties - GeoJSON feature properties from osmtogeojson
 * @returns Width in meters
 */
function extractRoadWidth(properties: Record<string, unknown>): number {
  // Try explicit width tag first
  const width = parseNumericTag(properties["width"] as string | undefined);
  if (!isNaN(width) && width > 0) return width;

  // Fall back to lanes × per-lane width
  const lanes = parseInt(properties["lanes"] as string, 10);
  if (!isNaN(lanes) && lanes > 0) return lanes * WIDTH_PER_LANE;

  return DEFAULT_ROAD_WIDTH;
}

/**
 * Simplifies a GeoJSON geometry using the Douglas-Peucker algorithm
 * via @turf/turf. Polygons use `mutate: true` for in-place simplification;
 * other geometry types are wrapped in a temporary Feature.
 *
 * @param geometry - The geometry to simplify
 * @returns Simplified geometry with reduced vertex count
 */
function simplifyGeometry<G extends GeoJSON.Geometry>(geometry: G): G {
  // turf.simplify operates on Feature or FeatureCollection
  if (
    geometry.type === "Polygon" ||
    geometry.type === "MultiPolygon"
  ) {
    return turf.simplify(
      { type: "Feature", geometry, properties: {} },
      { tolerance: SIMPLIFY_TOLERANCE, highQuality: false }
    ).geometry as G;
  }

  // For LineString, MultiLineString, Point, etc.
  const feature: GeoJSON.Feature<G> = {
    type: "Feature",
    geometry,
    properties: {},
  };
  return turf.simplify(feature, {
    tolerance: SIMPLIFY_TOLERANCE,
    highQuality: false,
  }).geometry as G;
}

/**
 * Filters a GeoJSON FeatureCollection into roads and buildings,
 * simplifies geometries to reduce vertex count, and enriches
 * each feature with computed height/width values.
 *
 * - **Roads**: features with a `highway` tag. Width is derived from
 *   `width` → `lanes × 3` → default 6m.
 * - **Buildings**: features with a `building` tag. Height is derived from
 *   `height` → `building:levels × 3` → default 10m.
 * - Features without either tag are silently skipped.
 * - Geometries are simplified with tolerance 0.0001 using Douglas-Peucker.
 *
 * @param features - GeoJSON FeatureCollection from osmtogeojson
 * @returns Separated and enriched roads and buildings
 */
export function filterAndSimplify(features: GeoJSON.FeatureCollection): {
  roads: GeoJSON.Feature[];
  buildings: GeoJSON.Feature[];
} {
  const roads: GeoJSON.Feature[] = [];
  const buildings: GeoJSON.Feature[] = [];

  for (const feature of features.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;

    try {
      const isRoad = typeof props["highway"] === "string";
      const isBuilding = typeof props["building"] === "string";

      // Skip features that are neither road nor building
      if (!isRoad && !isBuilding) continue;

      // Simplify geometry to reduce vertex count for rendering performance
      const simplifiedGeometry = simplifyGeometry(feature.geometry);

      if (isRoad) {
        roads.push({
          type: "Feature",
          geometry: simplifiedGeometry,
          properties: {
            ...props,
            width: extractRoadWidth(props),
          },
        });
      }

      if (isBuilding) {
        buildings.push({
          type: "Feature",
          geometry: simplifiedGeometry,
          properties: {
            ...props,
            height: extractBuildingHeight(props),
          },
        });
      }
    } catch (error) {
      // Log and skip malformed features rather than failing the whole batch
      console.warn(
        "Skipping malformed feature:",
        error instanceof Error ? error.message : error,
        props
      );
    }
  }

  return { roads, buildings };
}
