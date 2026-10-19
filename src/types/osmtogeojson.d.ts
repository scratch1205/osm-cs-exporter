declare module "osmtogeojson" {
  /**
   * Converts raw OSM JSON (from Overpass API or OSM API) into
   * a GeoJSON FeatureCollection.
   *
   * @param osmData - Raw OSM JSON with an `elements` array
   * @returns GeoJSON FeatureCollection
   */
  function osmtogeojson(
    osmData: unknown
  ): GeoJSON.FeatureCollection;

  export default osmtogeojson;
}
