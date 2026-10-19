// =============================================================================
// OSM Raw Data Interfaces
// =============================================================================

/** OSM element common fields */
export interface OSMElementBase {
  /** Unique OSM element ID */
  id: number;
  /** Key-value tag map (e.g. { highway: "residential", name: "Main St" }) */
  tags?: Record<string, string>;
  /** Timestamp of last edit (ISO 8601) */
  timestamp?: string;
  /** Changeset ID that last modified this element */
  changeset?: number;
  /** User who last edited this element */
  user?: string;
  /** UID of the user who last edited this element */
  uid?: number;
  /** Current version number of this element */
  version?: number;
}

/** OSM Node — a single geographic point with optional tags */
export interface OSMNode extends OSMElementBase {
  type: "node";
  /** WGS 84 latitude (−90 to +90) */
  lat: number;
  /** WGS 84 longitude (−180 to +180) */
  lon: number;
}

/** Reference to a node within a Way (used for ordered geometry) */
export interface OSMNodeRef {
  /** The node ID this ref points to */
  ref: number;
}

/** OSM Way — an ordered sequence of node references forming a linestring or polygon */
export interface OSMWay extends OSMElementBase {
  type: "way";
  /** Ordered node references defining the way's geometry */
  nodes: number[];
}

/** A single member of an OSM Relation */
export interface OSMRelationMember {
  /** Type of the referenced element */
  type: "node" | "way" | "relation";
  /** ID of the referenced element */
  ref: number;
  /** Role of this member within the relation (e.g. "outer", "inner", "forward") */
  role: string;
}

/** OSM Relation — a group of nodes, ways, and/or other relations */
export interface OSMRelation extends OSMElementBase {
  type: "relation";
  /** Ordered member list with roles */
  members: OSMRelationMember[];
}

/** Union of all raw OSM element types */
export type OSMElement = OSMNode | OSMWay | OSMRelation;

// =============================================================================
// OSM API Response
// =============================================================================

/** Bounding box used in Overpass / OSM API queries */
export interface OSMBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Raw OSM API JSON response (e.g. from /api/0.6/map.json) */
export interface OSMRawResponse {
  version?: string;
  generator?: string;
  bounds?: OSMBounds;
  elements: OSMElement[];
}

// =============================================================================
// GeoJSON Feature Interfaces (post-osmtogeojson conversion)
// =============================================================================

/** GeoJSON Geometry types we expect from OSM conversion */
export type OSMGeometry =
  | GeoJSON.Point
  | GeoJSON.LineString
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon;

/** Base properties shared by all converted OSM GeoJSON features */
export interface OSMFeatureProperties {
  /** Original OSM element type */
  type: "node" | "way" | "relation";
  /** Original OSM element ID */
  id: number;
  /** Full OSM tag map carried over from the source element */
  tags?: Record<string, string>;
  /** Human-readable name (from OSM "name" tag), if present */
  name?: string;
}

// ---------------------------------------------------------------------------
// Road Features
// ---------------------------------------------------------------------------

/** OSM highway classification values (subset of most common) */
export type OSMHighwayType =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "service"
  | "unclassified"
  | "living_street"
  | "pedestrian"
  | "footway"
  | "cycleway"
  | "path"
  | "track"
  | "motorway_link"
  | "trunk_link"
  | "primary_link"
  | "secondary_link"
  | "tertiary_link";

/** Road surface types (from OSM "surface" tag) */
export type OSMSurfaceType =
  | "asphalt"
  | "concrete"
  | "paved"
  | "unpaved"
  | "gravel"
  | "dirt"
  | "grass"
  | "cobblestone"
  | "sett"
  | "paving_stones"
  | "ground"
  | "sand";

/** Properties specific to road/path features (highway=* tags) */
export interface RoadProperties extends OSMFeatureProperties {
  /** OSM highway classification */
  highway: OSMHighwayType | string;
  /** Number of lanes (from "lanes" tag); defaults to undefined if not tagged */
  lanes?: number;
  /** Whether the road is one-way (from "oneway" tag) */
  oneway?: boolean;
  /** Maximum speed in km/h (from "maxspeed" tag, parsed) */
  maxspeed?: number;
  /** Road surface material (from "surface" tag) */
  surface?: OSMSurfaceType | string;
  /** Whether the road is a bridge (from "bridge" tag) */
  bridge?: boolean;
  /** Whether the road is a tunnel (from "tunnel" tag) */
  tunnel?: boolean;
  /** Road width in meters (from "width" tag); fallback to constants lookup */
  width?: number;
}

/** GeoJSON Feature representing a road or path */
export interface RoadFeature extends GeoJSON.Feature<OSMGeometry> {
  properties: RoadProperties;
}

// ---------------------------------------------------------------------------
// Building Features
// ---------------------------------------------------------------------------

/** OSM building type values (subset of common "building" tag values) */
export type OSMBuildingType =
  | "yes"
  | "residential"
  | "commercial"
  | "industrial"
  | "retail"
  | "apartments"
  | "house"
  | "garage"
  | "church"
  | "school"
  | "hospital"
  | "office"
  | "warehouse"
  | "shed"
  | "roof"
  | "farm_auxiliary"
  | "greenhouse";

/** Roof shape values (from OSM "roof:shape" tag) */
export type OSMRoofShape = "flat" | "skillion" | "gabled" | "hipped" | "pyramidal" | "round" | "dome";

/** Properties specific to building features (building=* tags) */
export interface BuildingProperties extends OSMFeatureProperties {
  /** OSM building type (the value of the "building" tag) */
  building: OSMBuildingType | string;
  /** Number of storeys above ground (from "building:levels" tag) */
  levels?: number;
  /** Number of underground levels (from "building:levels:underground" tag) */
  undergroundLevels?: number;
  /** Total building height in meters (from "height" tag, parsed) */
  height?: number;
  /** Minimum height in meters for elevated buildings (from "min_height" tag) */
  minHeight?: number;
  /** Roof shape (from "roof:shape" tag) */
  roofShape?: OSMRoofShape | string;
  /** Roof height in meters (from "roof:height" tag) */
  roofHeight?: number;
  /** Building / facade color (from "building:colour" or "building:material") */
  color?: string;
  /** Roof color (from "roof:colour") */
  roofColor?: string;
}

/** GeoJSON Feature representing a building */
export interface BuildingFeature extends GeoJSON.Feature<OSMGeometry> {
  properties: BuildingProperties;
}

// ---------------------------------------------------------------------------
// Feature Union & Collection
// ---------------------------------------------------------------------------

/** Union of all processed GeoJSON feature types derived from OSM data */
export type OSMFeature = RoadFeature | BuildingFeature;

/** FeatureCollection containing mixed OSM-derived features */
export interface OSMFeatureCollection
  extends GeoJSON.FeatureCollection<OSMGeometry, OSMFeatureProperties> {
  features: OSMFeature[];
}

/** Categorized result from processing raw OSM data into GeoJSON */
export interface ProcessedOSMData {
  /** All road/path features */
  roads: RoadFeature[];
  /** All building features */
  buildings: BuildingFeature[];
  /** Remaining features that didn't match road or building categories */
  other: GeoJSON.Feature<OSMGeometry, OSMFeatureProperties>[];
  /** Combined FeatureCollection for convenience */
  all: OSMFeatureCollection;
}
