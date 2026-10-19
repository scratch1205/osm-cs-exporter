import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import osmtogeojson from "osmtogeojson";
import {
  fetchOSMData,
  shouldUseWorker,
  convertOSMToGeoJSON,
  OverpassHttpError,
} from "../services/osmService";

vi.mock("osmtogeojson", () => ({
  default: vi.fn(),
}));

const mockBbox: [number, number, number, number] = [
  39.9, 116.3, 39.95, 116.4,
];

const emptyCollection: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** 模拟 Worker：postMessage 时用 mock 的 osmtogeojson 转换并异步回调 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;

  constructor(public url: string | URL, public options?: unknown) {}

  postMessage(data: unknown): void {
    const geojson = osmtogeojson(data);
    setTimeout(() => this.onmessage?.({ data: geojson }), 0);
  }

  terminate(): void {}
}

function mockFetchText(
  text: string,
  ok = true,
  status = 200,
  statusText = "OK"
): void {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok,
    status,
    statusText,
    text: async () => text,
  } as Response);
}

function mockFetchReject(error: Error): void {
  vi.mocked(fetch).mockRejectedValueOnce(error);
}

describe("osmService", () => {
  let workerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
    workerSpy = vi.fn();
    // 记录 Worker 实例化并代理到 FakeWorker
    vi.stubGlobal(
      "Worker",
      class extends FakeWorker {
        constructor(url: string | URL, options?: unknown) {
          super(url, options);
          workerSpy(url, options);
        }
      }
    );
    vi.mocked(osmtogeojson).mockReturnValue(emptyCollection as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("shouldUseWorker", () => {
    it("超过 5MB 时使用 Worker 转换", () => {
      expect(shouldUseWorker(5 * 1024 * 1024 + 1)).toBe(true);
    });

    it("等于或小于 5MB 时主线程转换", () => {
      expect(shouldUseWorker(5 * 1024 * 1024)).toBe(false);
      expect(shouldUseWorker(1024)).toBe(false);
    });
  });

  describe("fetchOSMData", () => {
    it("成功获取并转换数据", async () => {
      mockFetchText(JSON.stringify({ elements: [] }));
      vi.mocked(osmtogeojson).mockReturnValue({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [] },
            properties: { highway: "residential" },
          },
        ],
      } as never);

      const result = await fetchOSMData(mockBbox);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.type).toBe("FeatureCollection");
      expect(result.features).toHaveLength(1);
    });

    it("Overpass 无数据时返回空 FeatureCollection 而非抛错", async () => {
      mockFetchText(JSON.stringify({ elements: [] }));

      const result = await fetchOSMData(mockBbox);

      expect(result.type).toBe("FeatureCollection");
      expect(result.features).toHaveLength(0);
    });

    it("网络错误按指数退避重试，最终成功", async () => {
      vi.useFakeTimers();
      const err = new TypeError("Failed to fetch");
      mockFetchReject(err);
      mockFetchReject(err);
      mockFetchText(JSON.stringify({ elements: [] }));

      const promise = fetchOSMData(mockBbox, {
        retries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.features).toHaveLength(0);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("HTTP 429 限流时重试后成功", async () => {
      vi.useFakeTimers();
      mockFetchText("rate limited", false, 429, "Too Many Requests");
      mockFetchText(JSON.stringify({ elements: [] }));

      const promise = fetchOSMData(mockBbox, {
        retries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.type).toBe("FeatureCollection");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("重试耗尽后抛出最后一次错误", async () => {
      const err = new TypeError("Failed to fetch");
      mockFetchReject(err);
      mockFetchReject(err);
      mockFetchReject(err);

      await expect(
        fetchOSMData(mockBbox, { retries: 2, baseBackoffMs: 100 })
      ).rejects.toThrow("Failed to fetch");
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("非可重试错误（HTTP 400）直接抛出且不重试", async () => {
      mockFetchText("bad query", false, 400, "Bad Request");

      await expect(fetchOSMData(mockBbox)).rejects.toBeInstanceOf(
        OverpassHttpError
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("响应超过 5MB 时走 Worker 转换", async () => {
      // 构造一个 > 5MB 的响应体（内容为合法 JSON）
      const big = '{"elements":[],"pad":"' + "x".repeat(5 * 1024 * 1024) + '"}';
      mockFetchText(big);

      const result = await fetchOSMData(mockBbox);

      expect(result.type).toBe("FeatureCollection");
      // 大响应必须实例化 Worker 而不是主线程转换
      expect(workerSpy).toHaveBeenCalledTimes(1);
      expect(workerSpy.mock.calls[0][0].toString()).toContain("osmWorker");
    });

    it("构造正确的 Overpass 查询并 URL 编码提交", async () => {
      mockFetchText(JSON.stringify({ elements: [] }));

      await fetchOSMData([39.9, 116.3, 39.95, 116.4]);

      const callArgs = vi.mocked(fetch).mock.calls[0];
      const decodedBody = decodeURIComponent(
        (callArgs[1]?.body as string).replace(/^data=/, "")
      );
      expect(decodedBody).toContain("(39.9,116.3,39.95,116.4)");
      expect(decodedBody).toContain('way["highway"]');
      expect(decodedBody).toContain('way["building"]');
      expect(decodedBody).toContain("out skel qt");
    });
  });

  describe("convertOSMToGeoJSON", () => {
    it("主线程路径使用 osmtogeojson 转换", async () => {
      const result = await convertOSMToGeoJSON({ elements: [] });
      expect(osmtogeojson).toHaveBeenCalledWith({ elements: [] });
      expect(result.type).toBe("FeatureCollection");
    });
  });
});