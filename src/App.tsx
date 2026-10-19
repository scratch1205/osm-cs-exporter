import React from "react";
import MapSelector from "@/components/MapSelector";
import ScenePreview from "@/components/ScenePreview";
import ExportAllButton from "@/components/ExportAllButton";

const App: React.FC = () => {
  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight">
            OSM to Cities: Skylines Exporter
          </h1>
          <span className="hidden text-xs text-neutral-500 sm:inline">
            绘制区域 → 实时预览 → 导出全部文件（高度图/水/树/路网）
          </span>
        </div>
        <ExportAllButton />
      </header>
      <main className="flex flex-1 min-h-0">
        <section className="w-1/2 min-w-0 border-r border-neutral-800">
          <MapSelector />
        </section>
        <section className="w-1/2 min-w-0">
          <ScenePreview />
        </section>
      </main>
    </div>
  );
};

export default App;