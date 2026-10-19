import { describe, it, expect } from "vitest";
import { filterAndSimplify } from "../utils/geoProcessor";

describe("geoProcessor", () => {
  describe("filterAndSimplify", () => {
    it("should separate roads and buildings", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { highway: "residential" },
          },
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            properties: { building: "yes" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.roads).toHaveLength(1);
      expect(result.buildings).toHaveLength(1);
      expect(result.roads[0].properties!.highway).toBe("residential");
      expect(result.buildings[0].properties!.building).toBe("yes");
    });

    it("should extract building height from building:levels * 3", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            properties: { building: "residential", "building:levels": "5" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.buildings[0].properties!.height).toBe(15);
    });

    it("should use height tag when present", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            properties: { building: "yes", height: "25" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.buildings[0].properties!.height).toBe(25);
    });

    it("should default building height to 10m when no info available", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
              ],
            },
            properties: { building: "yes" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.buildings[0].properties!.height).toBe(10);
    });

    it("should extract road width from lanes * 3", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { highway: "primary", lanes: "2" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.roads[0].properties!.width).toBe(6);
    });

    it("should use width tag when present", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { highway: "residential", width: "8.5" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.roads[0].properties!.width).toBe(8.5);
    });

    it("should default road width to 6m when no info available", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: { highway: "residential" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.roads[0].properties!.width).toBe(6);
    });

    it("should handle empty feature collection", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const result = filterAndSimplify(input);

      expect(result.roads).toHaveLength(0);
      expect(result.buildings).toHaveLength(0);
    });

    it("should filter out features without highway or building tags", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [0, 0],
            },
            properties: { amenity: "restaurant" },
          },
        ],
      };

      const result = filterAndSimplify(input);

      expect(result.roads).toHaveLength(0);
      expect(result.buildings).toHaveLength(0);
    });
  });
});
