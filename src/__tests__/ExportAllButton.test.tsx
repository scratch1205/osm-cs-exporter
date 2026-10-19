// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExportAllButton from "../components/ExportAllButton";
import { useCityStore } from "../store/cityStore";
import { generateMapExportAssets } from "../services/mapExportPipeline";
import { generateCSMapPackage } from "../services/exportPackageService";

vi.mock("../services/mapExportPipeline", () => ({
  generateMapExportAssets: vi.fn(),
}));

vi.mock("../services/exportPackageService", () => ({
  generateCSMapPackage: vi.fn(),
}));

const mockBlob = () => new Blob(["x"], { type: "image/png" });

describe("ExportAllButton", () => {
  beforeEach(() => {
    useCityStore.setState({
      bbox: null,
      isLoading: false,
      generatedGroup: null,
      error: null,
    });
    vi.clearAllMocks();
    vi.mocked(generateMapExportAssets).mockResolvedValue({
      heightmap: mockBlob(),
      waterMask: mockBlob(),
      treeMask: mockBlob(),
      roadNetwork: new Blob(["{}"], { type: "application/json" }),
    });
    vi.mocked(generateCSMapPackage).mockResolvedValue();
  });

  it("未绘制区域（无 bbox）时按钮禁用", () => {
    render(<ExportAllButton />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("点击后生成全部文件并触发打包下载", async () => {
    const bbox: [number, number, number, number] = [39.9, 116.38, 39.92, 116.4];
    useCityStore.setState({ bbox });

    render(<ExportAllButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(generateMapExportAssets).toHaveBeenCalledWith(bbox)
    );
    expect(generateMapExportAssets).toHaveBeenCalledTimes(1);
    expect(generateCSMapPackage).toHaveBeenCalledTimes(1);

    // 四个 Blob 传递给打包器
    const [heightmap, waterMask, treeMask, roadNetwork] =
      vi.mocked(generateCSMapPackage).mock.calls[0];
    expect(heightmap).toBeInstanceOf(Blob);
    expect(waterMask).toBeInstanceOf(Blob);
    expect(treeMask).toBeInstanceOf(Blob);
    expect(roadNetwork).toBeInstanceOf(Blob);

    // 完成后按钮恢复可用
    const button = screen.getByRole("button") as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("生成失败时展示错误信息且不触发打包", async () => {
    const bbox: [number, number, number, number] = [39.9, 116.38, 39.92, 116.4];
    useCityStore.setState({ bbox });
    vi.mocked(generateMapExportAssets).mockRejectedValue(
      new Error("DEM 瓦片请求失败")
    );

    render(<ExportAllButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByText(/DEM 瓦片请求失败/)).toBeDefined()
    );
    expect(generateCSMapPackage).not.toHaveBeenCalled();
  });
});