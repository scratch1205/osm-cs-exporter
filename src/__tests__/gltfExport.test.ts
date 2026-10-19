import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { exportSceneToGLB } from "../utils/gltfExport";

/**
 * Node 环境没有 FileReader，而 GLTFExporter 的二进制路径依赖它。
 * 用 blob.arrayBuffer() 实现最小 polyfill（仅测试环境）。
 */
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
}

(globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;

describe("exportSceneToGLB", () => {
  it("将场景导出为二进制 GLB Blob", async () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(10, 20, 30),
      new THREE.MeshStandardMaterial({ color: "#ff0000" })
    );
    mesh.position.set(5, 5, 0);
    scene.add(mesh);

    const blob = await exportSceneToGLB(scene);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("model/gltf-binary");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("支持包含 InstancedMesh 的场景", async () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const instanced = new THREE.InstancedMesh(geometry, material, 2);
    const matrix = new THREE.Matrix4();
    instanced.setMatrixAt(0, matrix);
    instanced.setMatrixAt(
      1,
      matrix.makeTranslation(5, 0, 0)
    );
    scene.add(instanced);

    const blob = await exportSceneToGLB(scene);

    expect(blob.type).toBe("model/gltf-binary");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("空场景也能导出（虽无内容）", async () => {
    const scene = new THREE.Scene();
    const blob = await exportSceneToGLB(scene);
    expect(blob.type).toBe("model/gltf-binary");
  });
});