import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import {
  MAP_STYLE_URL,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
} from "@/utils/constants";
import { useCityStore } from "@/store/cityStore";
import { bboxFromFeature } from "@/utils/geo";
import { buildCity, CityDataEmptyError } from "@/services/buildCity";

/** mapbox-gl-draw draw.create 事件结构 */
interface DrawCreateEvent {
  features: GeoJSON.Feature[];
}

/**
 * 地图选区组件：Mapbox 地图 + Draw 绘制工具。
 *
 * 用户在地图上绘制多边形后，自动触发：
 *   bbox 提取 → Overpass 获取 → 过滤简化 → CityGenerator 生成 3D，
 * 期间显示加载遮罩，结果写入 Zustand store。
 */
export default function MapSelector() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tokenMissing, setTokenMissing] = useState(false);

  const isLoading = useCityStore((s) => s.isLoading);

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
    if (!token) {
      setTokenMissing(true);
      return;
    }
    if (!containerRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true },
    });
    map.addControl(draw as unknown as mapboxgl.Control, "top-left");
    map.addControl(new mapboxgl.NavigationControl(), "top-left");

    // mapbox-gl-draw 的 draw.* 事件通过 map 实例派发（非 draw 实例）：
    // 官方用法 map.on('draw.create', handler)。类型上用断言扩展事件名。
    const mapEvents = map as unknown as {
      on: (event: "draw.create", callback: (e: DrawCreateEvent) => void) => void;
    };
    mapEvents.on("draw.create", (e: DrawCreateEvent) => {
      void handleDrawCreate(e);
    });

    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 绘制完成：提取 bbox → 启动生成管道 */
  async function handleDrawCreate(e: DrawCreateEvent): Promise<void> {
    const feature = e.features[0];
    if (!feature) return;

    const bbox = bboxFromFeature(feature);
    if (!bbox) return;

    const store = useCityStore.getState();
    store.setBbox(bbox);
    store.setError(null);
    store.setLoading(true);

    try {
      const group = await buildCity(bbox);
      store.setGeneratedGroup(group);
    } catch (err) {
      store.setError(
        err instanceof CityDataEmptyError
          ? err.message
          : err instanceof Error
            ? err.message
            : "生成 3D 城市失败，请重试"
      );
      store.setGeneratedGroup(null);
    } finally {
      store.setLoading(false);
    }
  }

  if (tokenMissing) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-100 p-6">
        <p className="max-w-sm text-center text-sm text-neutral-500">
          未配置 Mapbox Access Token。请在项目根目录的{" "}
          <code className="rounded bg-neutral-200 px-1">.env</code> 中设置{" "}
          <code className="rounded bg-neutral-200 px-1">
            VITE_MAPBOX_TOKEN=your_token
          </code>
          后重启开发服务器。
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-lg bg-neutral-900/90 px-6 py-4 text-neutral-100 shadow-xl">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-500 border-t-white" />
            <span className="text-sm">正在获取并生成 3D 城市…</span>
          </div>
        </div>
      )}
    </div>
  );
}