import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type * as THREE from "three";

/**
 * 将 Three.js 场景导出为二进制 GLB Blob。
 *
 * 注意：GLTFExporter 必须从 `three/examples/jsm/exporters/` 导入，
 * 不能从 core three 导入（core 不包含任何 exporter）。
 *
 * @param scene - 要导出的场景 / Group（米制坐标）
 * @returns 二进制 GLB 的 Blob（type: model/gltf-binary）
 */
export async function exportSceneToGLB(
  scene: THREE.Object3D
): Promise<Blob> {
  const exporter = new GLTFExporter();

  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (res) => resolve(res as ArrayBuffer),
      reject,
      { binary: true }
    );
  });

  return new Blob([result], { type: "model/gltf-binary" });
}