// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import UPNG from "upng-js";
import { saveAs } from "file-saver";
import {
  buildCSMapPackage,
  generateCSMapPackage,
  exportMapPackage,
  buildReadmeInstructions,
} from "../services/exportPackageService";
import { encodeGrayscale16PNG } from "../utils/pngEncoder";

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}));

/** 生成一个 16 位灰度 PNG Blob（复用生产编码器） */
function makePngBlob(value = 32768): Blob {
  const png = encodeGrayscale16PNG(4, 4, new Uint16Array(16).fill(value));
  return new Blob([png], { type: "image/png" });
}

/** 生成一个 JSON Blob（路网） */
function makeRoadNetworkBlob(): Blob {
  return new Blob(
    [
      JSON.stringify({
        nodes: [{ id: "n0", x: 0, y: 0, z: 0 }],
        segments: [],
      }),
    ],
    { type: "application/json" }
  );
}

describe("buildCSMapPackage", () => {
  it("zip 包含完整的 C:S 目录结构（5 个文件）", async () => {
    const zip = await buildCSMapPackage(
      makePngBlob(),
      makePngBlob(),
      makePngBlob(),
      makeRoadNetworkBlob()
    );

    const zipFile = await JSZip.loadAsync(zip);
    // JSZip 会为目录生成额外条目（Heightmaps/、Maps/、Data/），只统计文件
    const fileNames = Object.keys(zipFile.files).filter((n) => !n.endsWith("/"));
    expect(fileNames).toContain("Heightmaps/Map.png");
    expect(fileNames).toContain("Maps/Water.png");
    expect(fileNames).toContain("Maps/Trees.png");
    expect(fileNames).toContain("Data/road_network.json");
    expect(fileNames).toContain("README_IMPORT_INSTRUCTIONS.txt");
    expect(fileNames).toHaveLength(5);
  });

  it("Map.png 为严格 16 位灰度 PNG", async () => {
    const zip = await buildCSMapPackage(
      makePngBlob(65535),
      makePngBlob(),
      makePngBlob(),
      makeRoadNetworkBlob()
    );
    const zipFile = await JSZip.loadAsync(zip);
    const buffer = await zipFile
      .file("Heightmaps/Map.png")!
      .async("arraybuffer");
    const decoded = UPNG.decode(buffer);
    expect(decoded.depth).toBe(16);
    expect(decoded.width).toBe(4);
  });

  it("road_network.json 内容与传入一致", async () => {
    const networkBlob = makeRoadNetworkBlob();
    const zip = await buildCSMapPackage(
      makePngBlob(),
      makePngBlob(),
      makePngBlob(),
      networkBlob
    );
    const zipFile = await JSZip.loadAsync(zip);
    const text = await zipFile.file("Data/road_network.json")!.async("text");
    const parsed = JSON.parse(text);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].id).toBe("n0");
  });

  it("README 为中英双语且包含导入指引", async () => {
    const readme = buildReadmeInstructions();
    expect(readme).toContain("Cities: Skylines");
    // 中文部分
    expect(readme).toContain("地图编辑器");
    // 英文部分
    expect(readme).toContain("Map Editor");
  });

  it("README 写入 zip 且提及 heightmap / water 文件", async () => {
    const zip = await buildCSMapPackage(
      makePngBlob(),
      makePngBlob(),
      makePngBlob(),
      makeRoadNetworkBlob()
    );
    const zipFile = await JSZip.loadAsync(zip);
    const text = await zipFile
      .file("README_IMPORT_INSTRUCTIONS.txt")!
      .async("text");
    expect(text).toContain("Map.png");
    expect(text).toContain("Water.png");
    expect(text).toContain("road_network.json");
  });
});

describe("generateCSMapPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("触发浏览器下载且文件名为 RealWorld_Map_Export.zip", async () => {
    await generateCSMapPackage(
      makePngBlob(),
      makePngBlob(),
      makePngBlob(),
      makeRoadNetworkBlob()
    );

    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(saveAs).mock.calls[0];
    expect(filename).toBe("RealWorld_Map_Export.zip");
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe("application/zip");
  });
});

describe("exportMapPackage（已迁移）", () => {
  it("三个掩膜 canvas 打包为三个 16 位灰度 PNG", async () => {
    const heightmap = createCanvas(8, 8) as unknown as HTMLCanvasElement;
    const watermask = createCanvas(8, 8) as unknown as HTMLCanvasElement;
    const treemask = createCanvas(8, 8) as unknown as HTMLCanvasElement;
    for (const canvas of [heightmap, watermask, treemask]) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#808000"; // R=128 G=128 → 16 位值 32896
      ctx.fillRect(0, 0, 8, 8);
    }

    const blob = await exportMapPackage({ heightmap, watermask, treemask });
    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files);
    expect(names).toContain("heightmap.png");
    expect(names).toContain("watermask.png");
    expect(names).toContain("treemask.png");

    for (const name of ["heightmap.png", "watermask.png", "treemask.png"]) {
      const buffer = await zip.file(name)!.async("arraybuffer");
      const decoded = UPNG.decode(buffer);
      expect(decoded.depth).toBe(16);
    }
  });
});