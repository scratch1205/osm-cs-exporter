import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { useCityStore } from "../store/cityStore";

/** 构造一个带 Mesh 的测试 Group */
function makeGroup(): THREE.Group {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#ff0000" })
    )
  );
  return group;
}

describe("cityStore", () => {
  const initialState = {
    bbox: null,
    isLoading: false,
    generatedGroup: null,
    error: null,
  };

  beforeEach(() => {
    useCityStore.setState(initialState);
  });

  it("初始状态符合契约", () => {
    const state = useCityStore.getState();
    expect(state.bbox).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.generatedGroup).toBeNull();
    expect(state.error).toBeNull();
  });

  it("setBbox 更新边界框", () => {
    const bbox: [number, number, number, number] = [39.9, 116.3, 39.95, 116.4];
    useCityStore.getState().setBbox(bbox);
    expect(useCityStore.getState().bbox).toEqual(bbox);
  });

  it("setLoading 切换加载状态", () => {
    useCityStore.getState().setLoading(true);
    expect(useCityStore.getState().isLoading).toBe(true);
    useCityStore.getState().setLoading(false);
    expect(useCityStore.getState().isLoading).toBe(false);
  });

  it("setError 记录错误信息", () => {
    useCityStore.getState().setError("Overpass API request failed: 429");
    expect(useCityStore.getState().error).toBe(
      "Overpass API request failed: 429"
    );
  });

  it("setGeneratedGroup 存入生成的 Group", () => {
    const group = makeGroup();
    useCityStore.getState().setGeneratedGroup(group);
    expect(useCityStore.getState().generatedGroup).toBe(group);
  });

  it("替换 generatedGroup 时释放旧 Group 的几何体与材质", () => {
    const oldGroup = makeGroup();
    const oldMesh = oldGroup.children[0] as THREE.Mesh;
    const geomSpy = vi.spyOn(oldMesh.geometry, "dispose");
    const matSpy = vi.spyOn(oldMesh.material as THREE.Material, "dispose");

    useCityStore.getState().setGeneratedGroup(oldGroup);
    useCityStore.getState().setGeneratedGroup(makeGroup());

    expect(geomSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
  });

  it("reset 清空全部状态并释放当前 Group", () => {
    const group = makeGroup();
    const mesh = group.children[0] as THREE.Mesh;
    const geomSpy = vi.spyOn(mesh.geometry, "dispose");

    useCityStore.getState().setBbox([1, 2, 3, 4]);
    useCityStore.getState().setLoading(true);
    useCityStore.getState().setError("boom");
    useCityStore.getState().setGeneratedGroup(group);

    useCityStore.getState().reset();

    const state = useCityStore.getState();
    expect(state.bbox).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.generatedGroup).toBeNull();
    expect(state.error).toBeNull();
    expect(geomSpy).toHaveBeenCalled();
  });
});