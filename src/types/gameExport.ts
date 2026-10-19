/**
 * 游戏导入用道路网络数据（Cities: Skylines 等需要矢量路网而非 3D 网格）。
 */

/** 游戏内道路等级 */
export type RoadSegmentType = "Highway" | "Arterial" | "Local";

/** 路网节点：x/z 为相对 bbox 中心的米制坐标，y 为高度（米） */
export interface RoadNode {
  /** 全局唯一节点 ID */
  id: string;
  /** 经度方向（米，相对 bbox 中心） */
  x: number;
  /** 高度（米；无 DEM 数据时为 0） */
  y: number;
  /** 纬度方向（米，相对 bbox 中心） */
  z: number;
}

/** 道路段：连接两个节点 */
export interface RoadSegment {
  /** 起点节点 ID */
  startNodeId: string;
  /** 终点节点 ID */
  endNodeId: string;
  /** 游戏内道路等级 */
  type: RoadSegmentType;
}

/** 完整道路网络 */
export interface RoadNetworkData {
  /** 去重后的全部节点 */
  nodes: RoadNode[];
  /** 全部道路段 */
  segments: RoadSegment[];
}