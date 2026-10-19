/** Canvas 工厂：生产环境使用浏览器 document，测试环境可注入实现 */
export type CanvasFactory = () => HTMLCanvasElement;

/** 浏览器默认工厂 */
export const browserCanvasFactory: CanvasFactory = () =>
  document.createElement("canvas");