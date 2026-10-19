import { create } from "zustand";
import type * as THREE from "three";
import { disposeObject3D } from "@/utils/dispose";

/** 城市生成应用的全局状态 */
export interface CityState {
  /** 当前选区的边界框 [south, west, north, east] */
  bbox: [number, number, number, number] | null;
  /** 是否正在获取/转换/生成 */
  isLoading: boolean;
  /** CityGenerator 生成的 3D Group（米制坐标） */
  generatedGroup: THREE.Group | null;
  /** 最近一次操作的错误信息（含空数据提示） */
  error: string | null;

  setBbox: (bbox: [number, number, number, number]) => void;
  setLoading: (loading: boolean) => void;
  setGeneratedGroup: (group: THREE.Group | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

/**
 * Zustand store。generatedGroup 持有 Three.js 对象，
 * 替换或 reset 时自动释放旧 Group 的 GPU 资源（geometry/material）。
 */
export const useCityStore = create<CityState>((set) => ({
  bbox: null,
  isLoading: false,
  generatedGroup: null,
  error: null,

  setBbox: (bbox) => set({ bbox }),

  setLoading: (isLoading) => set({ isLoading }),

  setGeneratedGroup: (generatedGroup) =>
    set((state) => {
      if (state.generatedGroup && state.generatedGroup !== generatedGroup) {
        disposeObject3D(state.generatedGroup);
      }
      return { generatedGroup };
    }),

  setError: (error) => set({ error }),

  reset: () =>
    set((state) => {
      if (state.generatedGroup) disposeObject3D(state.generatedGroup);
      return { bbox: null, isLoading: false, generatedGroup: null, error: null };
    }),
}));