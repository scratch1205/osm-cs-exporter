// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as THREE from "three";
import ExportButton from "../components/ExportButton";
import { useCityStore } from "../store/cityStore";

function makeGroup(): THREE.Group {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(10, 20, 30),
      new THREE.MeshStandardMaterial({ color: "#ff0000" })
    )
  );
  return group;
}

describe("ExportButton", () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let revokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useCityStore.setState({
      bbox: null,
      isLoading: false,
      generatedGroup: null,
      error: null,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // jsdom 未实现 URL.createObjectURL，手动挂载
    createSpy = vi.fn().mockReturnValue("blob:mock-glb");
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    });
  });

  it("无生成的 Group 时按钮禁用", () => {
    render(<ExportButton />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("点击后导出 city_export.glb 并触发下载", async () => {
    useCityStore.setState({ generatedGroup: makeGroup() });

    let clickedAnchor: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedAnchor = this;
      }
    );

    render(<ExportButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(clickedAnchor).not.toBeNull());

    expect(clickedAnchor!.download).toBe("city_export.glb");
    expect(clickedAnchor!.href).toContain("blob:mock-glb");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);

    // 导出完成后按钮恢复可用
    const button = screen.getByRole("button") as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});