import type * as THREE from "three";

/**
 * 递归释放 Object3D 树上的所有几何体与材质。
 *
 * 注：r151+ 的 InstancedBufferAttribute 已无 dispose 方法，
 * 实例缓冲随 geometry.dispose() 由渲染器统一释放。
 *
 * @param root - 场景根节点（Group / Mesh / Scene）
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => m.dispose());
    } else if (mesh.material) {
      (mesh.material as THREE.Material).dispose();
    }
  });
}