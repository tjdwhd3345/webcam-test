import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsIsCameraPanel } from "../AsIsCameraPanel";

const originalMediaDevices = navigator.mediaDevices;
const originalPermissions = navigator.permissions;

const createVideoTrack = () => {
  const eventTarget = new EventTarget();
  const stop = vi.fn();
  const settings: MediaTrackSettings = {
    deviceId: "back-main",
    facingMode: "environment",
    width: 1920,
    height: 1080,
  };
  const capabilities: MediaTrackCapabilities = {
    deviceId: "back-main",
    facingMode: ["environment"],
    width: { min: 640, max: 1920 },
    height: { min: 480, max: 1080 },
  };

  const track = {
    contentHint: "",
    enabled: true,
    id: "back-main-track",
    kind: "video",
    label: "Back Camera",
    muted: false,
    readyState: "live",
    onended: null,
    onmute: null,
    onunmute: null,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    clone: vi.fn(),
    getCapabilities: vi.fn(() => capabilities),
    getConstraints: vi.fn(() => ({})),
    getSettings: vi.fn(() => settings),
    stop,
  } as unknown as MediaStreamTrack;

  return { track, stop };
};

const createMediaStream = (track: MediaStreamTrack, id: string): MediaStream => {
  const eventTarget = new EventTarget();
  const stream = {
    active: true,
    id,
    onaddtrack: null,
    onremovetrack: null,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    addTrack: vi.fn(),
    clone: vi.fn(),
    getAudioTracks: vi.fn(() => []),
    getTrackById: vi.fn((trackId: string) => (trackId === track.id ? track : null)),
    getTracks: vi.fn(() => [track]),
    getVideoTracks: vi.fn(() => [track]),
    removeTrack: vi.fn(),
  };

  return stream as unknown as MediaStream;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: originalMediaDevices,
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: originalPermissions,
  });
});

describe("AsIsCameraPanel", () => {
  it("실제 AS-IS 훅으로 후면 스트림을 실행하고 정지한다", async () => {
    const { track, stop } = createVideoTrack();
    const playingStream = createMediaStream(track, "playing-stream");
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const video = typeof constraints.video === "object" ? constraints.video : undefined;

      if (video?.width && typeof video.width === "object" && video.width.min === 1920) {
        return playingStream;
      }

      const warmupTrack = createVideoTrack().track;
      return createMediaStream(warmupTrack, "warmup-stream");
    });
    const enumerateDevices = vi.fn().mockResolvedValue([
      {
        deviceId: "back-main",
        groupId: "back-group",
        kind: "videoinput",
        label: "Back Camera",
        toJSON: () => ({}),
        getCapabilities: () => ({
          deviceId: "back-main",
          facingMode: ["environment"],
          width: { min: 640, max: 1920 },
          height: { min: 480, max: 1080 },
        }),
      },
    ] satisfies Array<InputDeviceInfo>);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
      },
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      },
    });

    const user = userEvent.setup();
    render(<AsIsCameraPanel />);

    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));

    expect(await screen.findByText("스트림: playing")).toBeInTheDocument();
    expect(screen.getByText("해상도: 1920x1080")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: expect.objectContaining({
        facingMode: { ideal: "environment" },
        width: { ideal: 1920, min: 1920 },
        height: { ideal: 1080, min: 1080 },
      }),
      audio: false,
    });

    await user.click(screen.getByRole("button", { name: "정지" }));

    expect(stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("스트림: stopped")).toBeInTheDocument();
  });
});
