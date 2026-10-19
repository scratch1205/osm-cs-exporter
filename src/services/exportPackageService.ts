import JSZip from "jszip";
import { saveAs } from "file-saver";
import { exportCanvasAs16BitPNG } from "@/utils/imageExporter";

// =============================================================================
// C:S 地图导出包服务
//
// 职责：
// 1. exportMapPackage —— 三个掩膜 canvas → 通用 zip（已从 exportPackage.ts 迁移）
// 2. buildCSMapPackage / generateCSMapPackage —— 完整 C:S 导入包
//    （高度图/水图/树图/路网 JSON/双语 README）并触发浏览器下载
// =============================================================================

// ---------------------------------------------------------------------------
// 通用三掩膜包（迁移自 exportPackage.ts）
// ---------------------------------------------------------------------------

/** zip 内文件名（即 C:S 导入时的选择标识） */
export const MAP_PACKAGE_FILENAMES = {
  heightmap: "heightmap.png",
  watermask: "watermask.png",
  treemask: "treemask.png",
} as const;

/** 导出包的三个掩膜 canvas 输入 */
export interface MapPackageInputs {
  /** 16 位灰度高度图（R/G 编码） */
  heightmap: HTMLCanvasElement;
  /** 黑白水掩膜（黑=陆地，白=水面） */
  watermask: HTMLCanvasElement;
  /** 树木密度掩膜（黑=无树，白=密林） */
  treemask: HTMLCanvasElement;
}

/**
 * 将三个掩膜导出为单个 zip Blob（通用包，无路网与说明文件）。
 *
 * 三个文件均通过 exportCanvasAs16BitPNG 编码为严格 16 位灰度 PNG
 * （Cities: Skylines 要求，避免地形台阶/精度损失）。
 */
export async function exportMapPackage(
  inputs: MapPackageInputs
): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    MAP_PACKAGE_FILENAMES.heightmap,
    exportCanvasAs16BitPNG(inputs.heightmap)
  );
  zip.file(
    MAP_PACKAGE_FILENAMES.watermask,
    exportCanvasAs16BitPNG(inputs.watermask)
  );
  zip.file(
    MAP_PACKAGE_FILENAMES.treemask,
    exportCanvasAs16BitPNG(inputs.treemask)
  );
  return zip.generateAsync({ type: "blob" });
}

// ---------------------------------------------------------------------------
// C:S 完整导入包
// ---------------------------------------------------------------------------

/** 完整包下载文件名 */
export const CS_MAP_PACKAGE_FILENAME = "RealWorld_Map_Export.zip";

/** zip 内目录结构（C:S 导入惯例 + 路网数据 + 说明） */
export const CS_MAP_PACKAGE_PATHS = {
  heightmap: "Heightmaps/Map.png",
  watermask: "Maps/Water.png",
  treemask: "Maps/Trees.png",
  roadNetwork: "Data/road_network.json",
  readme: "README_IMPORT_INSTRUCTIONS.txt",
} as const;

/**
 * 生成中英双语导入说明（README_IMPORT_INSTRUCTIONS.txt 内容）。
 */
export function buildReadmeInstructions(): string {
  return [
    "================================================================================",
    "  Cities: Skylines Map Import Guide / 城市天际线地图导入说明",
    "================================================================================",
    "",
    "[EN] How to import this map:",
    "  1. Unzip this package to any folder.",
    "  2. In the game, open Content Manager -> Maps -> Import, or use the",
    "     Map Editor: New Map -> Import Heightmap).",
    "  3. Select Heightmaps/Map.png as the heightmap (16-bit grayscale).",
    "  4. Select Maps/Water.png as the water map (white = water, black = land).",
    "  5. Maps/Trees.png is the tree density mask (white = dense forest,",
    "     gray = sparse trees). Use it with a tree brush / tree map mod.",
    "  6. Data/road_network.json contains the road network (nodes & segments)",
    "     in game coordinates. A companion C# mod consumes this file to spawn",
    "     roads via NetManager (see CS_MOD_BLUEPRINT.md in the project repo).",
    "",
    "[中文] 导入步骤：",
    "  1. 将本压缩包解压到任意目录。",
    "  2. 游戏内打开「内容管理器 → 地图 → 导入」（或在「地图编辑器 → 新地图」",
    "     中选择导入高度图）。",
    "  3. 选择 Heightmaps/Map.png 作为高度图（16 位灰度）。",
    "  4. 选择 Maps/Water.png 作为水域图（白=水面，黑=陆地）。",
    "  5. Maps/Trees.png 为树木密度图（白=密林，灰=稀疏）——配合树木刷/",
    "     树木图层 Mod 使用。",
    "  6. Data/road_network.json 为道路网络数据（节点与路段，游戏坐标系）。",
    "     配套 C# Mod 通过 NetManager 根据该文件生成道路",
    "     （蓝图见工程根目录 CS_MOD_BLUEPRINT.md）。",
    "",
    "[Reference paths] 参考路径：",
    "  Heightmaps folder:  <Steam>/steamapps/common/Cities_Skylines/Files/MapEditor/Heightmaps",
    "  Water maps folder:  <Steam>/steamapps/common/Cities_Skylines/Files/MapEditor/Water",
    "  (Or import via Content Manager instead of copying files.)",
    "",
    "================================================================================",
    "",
  ].join("\n");
}

/**
 * 构建完整的 C:S 地图导入包（不触发下载）。
 *
 * zip 结构：
 *   Heightmaps/Map.png            16 位灰度高度图
 *   Maps/Water.png                水域掩膜
 *   Maps/Trees.png                树木密度掩膜
 *   Data/road_network.json        路网 JSON（节点 + 路段）
 *   README_IMPORT_INSTRUCTIONS.txt 中英双语导入说明
 *
 * @param heightmap - 16 位高度图 PNG Blob
 * @param waterMask - 水域掩膜 PNG Blob
 * @param treeMask - 树木密度掩膜 PNG Blob
 * @param roadNetwork - 路网 JSON Blob
 * @returns RealWorld_Map_Export.zip 的 Blob
 */
export async function buildCSMapPackage(
  heightmap: Blob,
  waterMask: Blob,
  treeMask: Blob,
  roadNetwork: Blob
): Promise<Blob> {
  const zip = new JSZip();
  zip.file(CS_MAP_PACKAGE_PATHS.heightmap, heightmap);
  zip.file(CS_MAP_PACKAGE_PATHS.watermask, waterMask);
  zip.file(CS_MAP_PACKAGE_PATHS.treemask, treeMask);
  zip.file(CS_MAP_PACKAGE_PATHS.roadNetwork, roadNetwork);
  zip.file(CS_MAP_PACKAGE_PATHS.readme, buildReadmeInstructions());
  return zip.generateAsync({ type: "blob" });
}

/**
 * 构建并触发浏览器下载完整 C:S 地图导入包。
 *
 * @param heightmap - 16 位高度图 PNG Blob
 * @param waterMask - 水域掩膜 PNG Blob
 * @param treeMask - 树木密度掩膜 PNG Blob
 * @param roadNetwork - 路网 JSON Blob
 */
export async function generateCSMapPackage(
  heightmap: Blob,
  waterMask: Blob,
  treeMask: Blob,
  roadNetwork: Blob
): Promise<void> {
  const blob = await buildCSMapPackage(
    heightmap,
    waterMask,
    treeMask,
    roadNetwork
  );
  saveAs(blob, CS_MAP_PACKAGE_FILENAME);
}