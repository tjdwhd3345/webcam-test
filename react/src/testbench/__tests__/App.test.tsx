import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";

const originalMediaDevices = navigator.mediaDevices;
let getUserMedia: ReturnType<typeof vi.fn>;

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const createVideoTrack = (id: string) => {
  const eventTarget = new EventTarget();
  const stop = vi.fn();
  const track = {
    contentHint: "",
    enabled: true,
    id: `${id}-track`,
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
    getCapabilities: vi.fn(() => ({ deviceId: "back-main", facingMode: ["environment"] })),
    getConstraints: vi.fn(() => ({})),
    getSettings: vi.fn(() => ({ deviceId: "back-main", facingMode: "environment", width: 1920, height: 1080 })),
    stop,
  } as unknown as MediaStreamTrack;

  return { track, stop };
};

const createMediaStream = (track: MediaStreamTrack, id: string): MediaStream => {
  const eventTarget = new EventTarget();
  return {
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
  } as unknown as MediaStream;
};

beforeEach(() => {
  const mediaDevicesTarget = new EventTarget();
  getUserMedia = vi.fn(async () => {
    const warmupTrack = createVideoTrack("warmup").track;
    return createMediaStream(warmupTrack, "warmup-stream");
  });

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      ondevicechange: null,
      addEventListener: mediaDevicesTarget.addEventListener.bind(mediaDevicesTarget),
      removeEventListener: mediaDevicesTarget.removeEventListener.bind(mediaDevicesTarget),
      dispatchEvent: mediaDevicesTarget.dispatchEvent.bind(mediaDevicesTarget),
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue([
        {
          deviceId: "back-main",
          groupId: "back-main-group",
          kind: "videoinput",
          label: "Back Camera",
          toJSON: () => ({}),
          getCapabilities: () => ({ deviceId: "back-main", facingMode: ["environment"] }),
        } satisfies InputDeviceInfo,
      ]),
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

    expect(screen.getByRole("heading", { name: "TO-BE" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AS-IS" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "테스트 방식" }), "as-is");

    expect(screen.queryByRole("heading", { name: "TO-BE" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AS-IS" })).toBeInTheDocument();
  });

  it("TO-BE의 active 및 pending manual stream을 mode switch로 정리하고 AS-IS만 유지한다", async () => {
    const activeTrack = createVideoTrack("active-mode-switch");
    const pendingTrack = createVideoTrack("pending-mode-switch");
    const pendingManual = createDeferred<MediaStream>();
    let manualRequestCount = 0;
    getUserMedia.mockImplementation((constraints: MediaStreamConstraints) => {
      const video = typeof constraints.video === "object" ? constraints.video : undefined;
      if (video?.deviceId && typeof video.deviceId === "object" && "exact" in video.deviceId) {
        manualRequestCount += 1;
        return manualRequestCount === 1
          ? Promise.resolve(createMediaStream(activeTrack.track, "active-mode-switch-stream"))
          : pendingManual.promise;
      }

      const warmupTrack = createVideoTrack(`warmup-${getUserMedia.mock.calls.length}`).track;
      return Promise.resolve(createMediaStream(warmupTrack, `warmup-stream-${getUserMedia.mock.calls.length}`));
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<App />);
    const modeSelect = screen.getByRole("combobox", { name: "테스트 방식" });
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(await screen.findByText("스트림: playing")).toBeInTheDocument();

    await user.selectOptions(modeSelect, "as-is");
    expect(activeTrack.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "AS-IS" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "TO-BE" })).not.toBeInTheDocument();

    await user.selectOptions(modeSelect, "to-be");
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    await waitFor(() => expect(manualRequestCount).toBe(2));
    await user.selectOptions(modeSelect, "as-is");

    await act(async () => {
      pendingManual.resolve(createMediaStream(pendingTrack.track, "pending-mode-switch-stream"));
      await pendingManual.promise;
    });

    await waitFor(() => expect(pendingTrack.stop).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "AS-IS" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "TO-BE" })).not.toBeInTheDocument();
    expect(screen.queryByText("pending-mode-switch-stream")).not.toBeInTheDocument();
  });
});
