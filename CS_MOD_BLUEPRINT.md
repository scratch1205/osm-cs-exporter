# CS_MOD_BLUEPRINT.md — Cities: Skylines 路网导入 Mod 蓝图

> 本文档是 **代码逻辑蓝图**（供 Unity / C:S Mod 开发者参考），不是可编译的完整工程。
> 目标：读取 `RealWorld_Map_Export.zip` 内的 `Data/road_network.json`（本工具阶段四产物），
> 通过游戏 `NetManager` API 在 C:S 世界中生成道路节点与路段。

---

## 1. 整体架构

```
road_network.json（玩家桌面）
        │  File.ReadAllText(桌面路径)
        ▼
 JSON 解析（SimpleJSON 或手写轻量解析器）
        │  节点 {id,x,y,z} / 路段 {startNodeId,endNodeId,type}
        ▼
 坐标换算（相对米制 → 游戏世界坐标 Vector3）
        │
        ▼
 NetManager.CreateNode（全部节点）
        │  记录 jsonId → gameNodeId 映射
        ▼
 NetManager.CreateSegment（全部路段，按 type 选 NetInfo 预设）
```

触发方式（二选一，推荐 1）：
1. **Harmony Patch**：钩住 `LoadingManager` 的场景加载完成事件（如 `LoadLevelComplete` 触发一次导入）；
2. **快捷键**：Mod 设置面板/键盘热键手动触发（便于反复调试）。

## 2. 文件结构

```
CSMapImporter/
├── CSMapImporter.cs        // IUserMod 入口
├── RoadNetworkLoader.cs    // JSON 读取 + 解析 + 坐标转换
├── RoadSpawner.cs          // NetManager 生成节点/路段
├── RoadNetworkJson.cs      // 与 web 端 RoadNetworkData 对应的数据类
├── HarmonyPatches.cs       // Harmony 补丁（挂载触发点）
└── CSMapImporter.csproj    // 引用：UnityEngine.dll, Assembly-CSharp.dll,
                            // ICities.dll, 0Harmony.dll（Harmony）
```

## 3. 关键代码骨架（逻辑示意，非编译级）

### 3.1 IUserMod 入口

```csharp
using ICities;

public class CSMapImporter : IUserMod
{
    public string Name => "RealWorld Map Road Importer";
    public string Description => "Imports road_network.json from desktop and spawns roads via NetManager (blueprint).";

    public void OnEnabled()  { HarmonyPatches.Apply(); }   // 挂载补丁
    public void OnDisabled() { HarmonyPatches.Remove(); }  // 卸载补丁
}
```

### 3.2 数据类（与 web 端 `RoadNetworkData` 一一对应）

```csharp
public class RoadNetworkData
{
    public List<RoadNode> nodes;      // { id, x, y, z }
    public List<RoadSegment> segments; // { startNodeId, endNodeId, type }
}

public class RoadNode    { public string id; public float x; public float y; public float z; }
public class RoadSegment { public string startNodeId; public string endNodeId; public string type; }
// type ∈ "Highway" | "Arterial" | "Local"（web 端已映射完成）
```

### 3.3 JSON 读取（桌面固定路径，可后续改为设置项）

```csharp
public static RoadNetworkData LoadFromDesktop(string fileName = "road_network.json")
{
    // 注意：C:S（Windows）桌面路径
    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    string path = Path.Combine(desktop, fileName);
    if (!File.Exists(path))
        throw new FileNotFoundException("road_network.json not found on Desktop", path);

    string json = File.ReadAllText(path);
    // 推荐 SimpleJSON（单文件、无外部依赖）：
    // var root = SimpleJSON.JSON.Parse(json);
    // 或使用手写解析器逐字段读取（蓝图级别，未绑定具体库）
    return Parse(json);
}
```

### 3.4 坐标换算：相对米制 → 游戏世界坐标

```csharp
// Web 端坐标系：x/z 为相对选区中心（bbox 中心）的米制偏移，y 为高度（米）。
// C:S 世界坐标系：本地地图 1920×1920 单位，世界原点在角点；地图中心 ≈ (960, y, 960)。
// 换算思路（关键参数可按地图尺寸调节）：
public static Vector3 ToGamePosition(RoadNode node, Vector3 mapCenter, float scale = 1f)
{
    return new Vector3(
        mapCenter.x + node.x * scale,   // 经度方向 → X
        node.y * scale,                 // 高度 → Y（与高程图 16 位缩放对齐）
        mapCenter.z + node.z * scale    // 纬度方向 → Z
    );
}
// 说明：若高度图 16 位值已线性映射到 0-1024 单位，则 y 需按同一比例换算。
```

### 3.5 生成节点与路段（NetManager 核心）

```csharp
using ColossalFramework;
using UnityEngine;

// 原型（真实签名以游戏版本为准）：
//   NetManager.CreateNode(ushort nodeId, ref NetInfo info, ref CreateNodeInfo data, int level)
//   NetManager.CreateSegment(ushort segmentId, ref NetInfo info, ref CreateSegmentInfo data, int level)

public static class RoadSpawner
{
    // json 节点 id → 游戏节点 ushort id
    private static readonly Dictionary<string, ushort> NodeIdMap = new Dictionary<string, ushort>();

    // 道路等级 → NetInfo 预设名（可按喜好替换为美术资源）
    private static readonly Dictionary<string, string> NetPrefabByType = new Dictionary<string, string>
    {
        { "Highway",  "Highway 2+2" },        // 高速
        { "Arterial", "Basic Road 6L" },      // 主干道
        { "Local",    "Basic Road" },         // 普通道路
    };

    public static void SpawnAll(RoadNetworkData data, Vector3 mapCenter)
    {
        NetManager net = Singleton<NetManager>.instance;

        // ── 第一遍：生成全部节点 ──
        foreach (RoadNode node in data.nodes)
        {
            NetInfo info = PrefabCollection<NetInfo>.FindLoaded(NetPrefabByType["Local"]);
            CreateNodeInfo createInfo;
            createInfo.m_position = ToGamePosition(node, mapCenter);
            createInfo.m_flags = 0;                 // 可加 CREATE_FLAGS.UNDERGROUND 等
            createInfo.m_owner = 0;

            // 真实 API：CreateNode 返回新节点 id（ushort），失败返回 0
            ushort newId = net.CreateNode(out ushort nodeId ...); // 示意：按版本取返回值
            if (newId != 0)
                NodeIdMap[node.id] = newId;
        }

        // ── 第二遍：生成全部路段 ──
        foreach (RoadSegment seg in data.segments)
        {
            if (!NodeIdMap.TryGetValue(seg.startNodeId, out ushort startId) ||
                !NodeIdMap.TryGetValue(seg.endNodeId, out ushort endId) ||
                startId == endId)
                continue; // 跳过缺失/自环路段

            NetInfo info = PrefabCollection<NetInfo>.FindLoaded(
                NetPrefabByType.TryGetValue(seg.type, out string name) ? name : "Basic Road");

            // 示意：CreateSegmentInfo 需填充 startNode/endNode
            // net.CreateSegment(out ushort segmentId, ref info, ref createInfo, 0);
        }
    }
}
```

> ⚠️ **蓝图说明**：C:S 的 `NetManager.CreateNode/CreateSegment` 签名随游戏版本（DLC/官方更新）变化，
> 正式实现前请对照 `Assembly-CSharp.dll` 反编译签名调整参数与返回值处理；
> 生成前建议先 `NetManager.ExistsNode` / 区域检查（`BuildingManager` 冲突、水面）过滤非法位置。

### 3.6 Harmony 补丁（触发点示例）

```csharp
using HarmonyLib;

public static class HarmonyPatches
{
    private static Harmony _harmony;

    public static void Apply()
    {
        _harmony ??= new Harmony("com.example.csmapimporter");
        _harmony.PatchAll(); // 自动收集本程序集 [HarmonyPatch] 标记
    }

    public static void Remove() => _harmony?.UnpatchAll("com.example.csmapimporter");
}

// 在场景加载完成后自动导入一次：
[HarmonyPatch(typeof(LoadingManager), "CompleteLoadingScreen")]
public static class Patch_LoadingComplete
{
    public static void Postfix()
    {
        // 延迟一帧，确保 NetManager 可用
        Singleton<SimulationManager>.instance.AddAction(() =>
        {
            RoadNetworkData data = RoadNetworkLoader.LoadFromDesktop();
            RoadSpawner.SpawnAll(data, new Vector3(960, 0, 960));
            // 不每帧/不重复触发：建议用静态标志位防重入
        });
    }
}
```

## 4. 对接本工具（Web 端）

调用 `generateCSMapPackage(...)` 后，zip 内 `Data/road_network.json` 即本蓝图消费的数据源。
把该文件放到玩家桌面（Mod 默认读取路径）后，Mod 即可生成道路。

## 5. 注意事项

- **不要**在每帧 Update 里调用 `NetManager.CreateNode`（性能/稳定性风险），在加载完成或按键时批量执行；
- 节点数过多会导致游戏卡顿：Web 端已用 turf simplify（容差 ~0.00005）压缩节点，Mod 端建议再按最小间距过滤；
- 路段方向（start/end）不影响无向道路渲染，但 `NetSegment` 连接方向影响车道流向，生成时建议统一方向规范；
- 删除/回滚：正式版建议先 `NetManager.CreateNode` 前记录 id 区间，或用游戏自带 `MarqueeTool` 手动清理。

---
内容由 AI 生成