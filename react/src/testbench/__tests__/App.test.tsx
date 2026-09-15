import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";

const originalMediaDevices = navigator.mediaDevices;

beforeEach(() => {
  const mediaDevicesTarget = new EventTarget();
  const warmupStream = {
    getTracks: vi.fn(() => [{ stop: vi.fn() }]),
  } as unknown as MediaStream;

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      ondevicechange: null,
      addEventListener: mediaDevicesTarget.addEventListener.bind(mediaDevicesTarget),
      removeEventListener: mediaDevicesTarget.removeEventListener.bind(mediaDevicesTarget),
      dispatchEvent: mediaDevicesTarget.dispatchEvent.bind(mediaDevicesTarget),
      getUserMedia: vi.fn().mockResolvedValue(warmupStream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      getSupportedConstraints: vi.fn(() => ({})),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  });
});

describe("App", () => {
  it("선택한 모드의 패널만 mount한다", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "AS-IS" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "TO-BE" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "테스트 방식" }), "to-be");

    expect(screen.queryByRole("heading", { name: "AS-IS" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "TO-BE" })).toBeInTheDocument();
  });
});
