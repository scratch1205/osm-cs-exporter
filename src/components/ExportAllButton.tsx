import { useState } from "react";
import { Loader2, FolderArchive } from "lucide-react";
import { useCityStore } from "@/store/cityStore";
import { generateMapExportAssets } from "@/services/mapExportPipeline";
import { generateCSMapPackage } from "@/services/exportPackageService";

/**
 * 「导出全部文件」按钮：将当前选区的
 * 高度图 / 水掩膜 / 树掩膜 / 路网 JSON 打包为 RealWorld_Map_Export.zip 下载。
 */
export default function ExportAllButton() {
  const bbox = useCityStore((s) => s.bbox);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (): Promise<void> => {
    if (!bbox || exporting) return;

    setExporting(true);
    setError(null);
    try {
      const assets = await generateMapExportAssets(bbox);
      await generateCSMapPackage(
        assets.heightmap,
        assets.waterMask,
        assets.treeMask,
        assets.roadNetwork
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败，请重试");
    } finally {
      setExporting(false);
    }
  };

  const disabled = !bbox || exporting;

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="max-w-xs truncate text-xs text-red-400" title={error}>
          {error}
        </span>
      )}
      <button
        onClick={() => void handleExport()}
        disabled={disabled}
        title={
          !bbox ? "先在左侧地图绘制一个区域" : "导出全部文件（zip）"
        }
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-neutral-600 disabled:text-neutral-400"
      >
        {exporting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            正在生成 5 个文件…
          </>
        ) : (
          <>
            <FolderArchive className="h-4 w-4" />
            导出全部文件
          </>
        )}
      </button>
    </div>
  );
}