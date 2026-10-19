// =============================================================================
// Road Width Defaults (meters) by OSM highway=* tag value
// =============================================================================

/** Default road widths in meters, keyed by OSM "highway" tag value. */
export const DEFAULT_ROAD_WIDTHS: Record<string, number> = {
  motorway: 24,
  trunk: 18,
  primary: 14,
  secondary: 11,
  tertiary: 9,
  residential: 7,
  service: 4,
  unclassified: 7,
  living_street: 6,
  pedestrian: 4,
  footway: 2.5,
  cycleway: 2,
  path: 1.5,
  track: 3,
  motorway_link: 7,
  trunk_link: 7,
  primary_link: 7,
  secondary_link: 6,
  tertiary_link: 5,
} as const;

/** Fallback road width (meters) when the highway type is unrecognized */
export const FALLBACK_ROAD_WIDTH = 6;

// =============================================================================
// Building Height Defaults (meters) by OSM building=* tag value
// =============================================================================

/** Default building heights in meters, keyed by OSM "building" tag value.
 *  Used when no "height" or "building:levels" tag is present. */
export const DEFAULT_BUILDING_HEIGHTS: Record<string, number> = {
  yes: 10,
  residential: 12,
  commercial: 15,
  industrial: 10,
  retail: 8,
  apartments: 18,
  house: 7,
  garage: 3.5,
  church: 12,
  school: 10,
  hospital: 18,
  office: 24,
  warehouse: 8,
  shed: 3,
  roof: 3,
  farm_auxiliary: 5,
  greenhouse: 4,
} as const;

/** Height per storey (meters) used to derive height from building:levels */
export const HEIGHT_PER_LEVEL = 3.2;

/** Fallback building height (meters) when the building type is unrecognized */
export const FALLBACK_BUILDING_HEIGHT = 10;

// =============================================================================
// Color Palettes by OSM tag values (hex strings for Three.js materials)
// =============================================================================

/** Road surface colors keyed by highway type. Used for 3D mesh materials. */
export const ROAD_COLORS: Record<string, string> = {
  motorway: "#4a4a4a",
  trunk: "#555555",
  primary: "#606060",
  secondary: "#6a6a6a",
  tertiary: "#707070",
  residential: "#787878",
  service: "#808080",
  unclassified: "#757575",
  living_street: "#8a8a7a",
  pedestrian: "#b0a898",
  footway: "#c8b8a0",
  cycleway: "#cc3333",
  path: "#a89070",
  track: "#9a8060",
} as const;

/** Fallback road color when the highway type is unrecognized */
export const FALLBACK_ROAD_COLOR = "#666666";

/** Building wall colors keyed by building type. */
export const BUILDING_COLORS: Record<string, string> = {
  yes: "#c8c0b8",
  residential: "#d4c8b8",
  commercial: "#a8b8c8",
  industrial: "#b0b0a8",
  retail: "#c8b8a8",
  apartments: "#c0c0c8",
  house: "#d8d0c0",
  garage: "#a8a8a0",
  church: "#e0d8c8",
  school: "#b8c8d8",
  hospital: "#e8e8f0",
  office: "#98a8b8",
  warehouse: "#a0a098",
  shed: "#988878",
} as const;

/** Fallback building color when the building type is unrecognized */
export const FALLBACK_BUILDING_COLOR = "#c0c0c0";

/** Default roof color applied when no "roof:colour" tag is present */
export const DEFAULT_ROOF_COLOR = "#8b4513";

// =============================================================================
// Scene / Render Defaults
// =============================================================================

/** MapLibre / Mapbox default center [lng, lat] */
export const DEFAULT_MAP_CENTER: [number, number] = [116.3975, 39.9087]; // Beijing

/** Default map zoom level */
export const DEFAULT_MAP_ZOOM = 15;

/** Mapbox GL style URL (streets) */
export const MAP_STYLE_URL = "mapbox://styles/mapbox/streets-v12";

/** Three.js scene background color */
export const SCENE_BACKGROUND_COLOR = 0x1a1a2e;

/** Ambient light intensity for the 3D scene */
export const AMBIENT_LIGHT_INTENSITY = 0.6;

/** Directional light intensity for the 3D scene */
export const DIRECTIONAL_LIGHT_INTENSITY = 0.8;

/** Directional light position [x, y, z] */
export const DIRECTIONAL_LIGHT_POSITION: [number, number, number] = [50, 100, 50];

/** GLTF export binary format (.glb). Set false for .gltf JSON + .bin. */
export const EXPORT_BINARY = true;

/** Scale factor from GeoJSON coordinates (degrees) to Three.js units (meters).
 *  Applied during the coordinate projection step. */
export const GEO_SCALE_FACTOR = 1.0;

// =============================================================================
// Overpass API
// =============================================================================

/** Default Overpass API endpoint */
export const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";

/** Overpass query timeout (seconds) */
export const OVERPASS_TIMEOUT = 30;
