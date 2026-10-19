import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useCityStore } from "@/store/cityStore";
import {
  SCENE_BACKGROUND_COLOR,
  AMBIENT_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_POSITION,
} from "@/utils/constants";

/**
 * 3D 预览组件：React Three Fiber Canvas。
 *
 * 展示 CityGenerator 生成的 Group（米制坐标），
 * 提供轨道控制器与基础光照（环境光 + 平行光）。
 */
export default function ScenePreview() {
  const group = useCityStore((s) => s.generatedGroup);
  const isLoading = useCityStore((s) => s.isLoading);
  const error = useCityStore((s) => s.error);

  return (
    <div className="relative h-full w-full bg-neutral-950">
      {!group && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
            {isLoading ? (
              <>
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
                <p className="text-sm text-neutral-400">正在生成 3D 城市…</p>
              </>
            ) : error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : (
              <>
                <p className="text-2xl">🏙️</p>
                <p className="text-sm text-neutral-500">
                  在左侧地图上绘制一个多边形区域，
                  <br />
                  这里将实时生成 3D 城市模型
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {group && (
        <Canvas
          camera={{ position: [250, 250, 250], fov: 50, near: 0.1, far: 5000 }}
        >
          <color attach="background" args={[SCENE_BACKGROUND_COLOR]} />
          <ambientLight intensity={AMBIENT_LIGHT_INTENSITY} />
          <directionalLight
            position={DIRECTIONAL_LIGHT_POSITION}
            intensity={DIRECTIONAL_LIGHT_INTENSITY}
          />
          <primitive object={group} />
          <OrbitControls makeDefault target={[0, 0, 10]} />
        </Canvas>
      )}
    </div>
  );
}