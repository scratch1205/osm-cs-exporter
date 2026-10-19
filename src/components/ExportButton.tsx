import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useCityStore } from "@/store/cityStore";
import { exportSceneToGLB } from "@/utils/gltfExport";

/** 导出文件名 */
export const EXPORT_FILENAME = "city_export.glb";

/**
 * GLB 导出按钮：将当前生成的 3D 城市导出为二进制 .glb 文件。
 *
 * 使用 three/examples/jsm 的 GLTFExporter（binary: true），
 * 导出期间按钮显示进度状态，完成后通过 Blob URL 触发浏览器下载。
 */
export default function ExportButton() {
  const group = useCityStore((s) => s.generatedGroup);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (): Promise<void> => {
    if (!group || exporting) return;

    setExporting(true);
    try {
      const blob = await exportSceneToGLB(group);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = EXPORT_FILENAME;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const disabled = !group || exporting;

  return (
    <button
      onClick={() => void handleExport()}
      disabled={disabled}
      title={!group ? "先在左侧地图绘制区域生成 3D 模型" : "导出 GLB 模型"}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-600 disabled:text-neutral-400"
    >
      {exporting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {exporting ? "导出中…" : "导出 GLB"}
    </button>
  );
}