# Tree Density Mask + 导出包 — 设计文档

- 日期：2026-10-17
- 项目：osm-3d-exporter（Cities: Skylines 地图导出工具）
- 背景：在 Heightmap（16 位灰度地形）与 Water Mask（黑白水掩膜）之后，新增树木密度掩膜，并打包为 zip 供 C:S 导入。

## 澄清决策（用户 2026-10-17 确认）

1. 标签强度：`natural=wood`→255、`landuse=forest`→230、`natural=scrub`→160、`leisure=park`→128
2. 重叠处理：取最大值（同一像素被多类型覆盖时取最大强度）
3. 导出格式：zip 打包单个文件（新增 jszip 依赖）

## 架构

### 1. `src/services/vegetationService.ts`（新建）

```
generateTreeMask(osmGeoJSON, bbox, resolution=1081, canvasFactory?)
  → HTMLCanvasElement（黑=无树，灰阶=稀疏，白=密林）
```

- 过滤标签：natural=wood / landuse=forest / leisure=park / natural=scrub（Polygon / MultiPolygon）
- 强度映射表 VEGETATION_INTENSITY
- 重叠取最大值的实现：逐要素绘制到临时 canvas → getImageData → 与累积强度数组（Uint8Array）逐像素 max → 全部处理完后一次性写入输出 canvas（R=G=强度, B=0, A=255）
- 16 位导出像素值 = 强度×257，高字节即原强度，C:S 任意位深读取正确
- canvas 工厂可注入（与 waterService 相同模式）

### 2. `src/services/exportPackage.ts`（新建）

```
exportMapPackage({ heightmap, watermask, treemask })
  → Promise<Blob>（city_export.zip）
```

- jszip 打包三个文件，均走 exportCanvasAs16BitPNG（严格 16 位灰度）：
  - `heightmap.png` / `watermask.png` / `treemask.png`
- 新增依赖 jszip@3.10.2（自带 TS 类型）

## 数据流

```
OSM GeoJSON ──generateTreeMask──▶ treemask canvas ──┐
heightmap canvas ────────────────────────────────────┼──exportMapPackage──▶ city_export.zip
watermask canvas ────────────────────────────────────┘
```

## 测试计划

- `vegetationService.test.ts`：四标签过滤与强度值、重叠取 max（森林覆盖公园）、空数据全黑、MultiPolygon、坐标映射（north→上）
- `exportPackage.test.ts`：zip 含三个文件；解压后 UPNG.decode 验证均为合法 16 位灰度 PNG
- canvas 用 @napi-rs/canvas 注入；jszip 在 node 环境可 loadAsync 解压验证

## 用户批准

用户于 2026-10-17 21:52 回复："设计完全 OK，批准实现！"

---
内容由 AI 生成