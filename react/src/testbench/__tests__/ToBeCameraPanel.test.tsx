import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToBeCameraPanel } from "../ToBeCameraPanel";

const originalMediaDevices = navigator.mediaDevices;
const originalPermissions = navigator.permissions;

type FakeTrack = {
  track: MediaStreamTrack;
  stop: ReturnType<typeof vi.fn>;
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

const getRenderedExecution = (): HTMLElement => {
  const section = screen.getByRole("heading", { name: "실행 정보" }).closest("section");
  const execution = section?.querySelector("pre");
  if (!execution) throw new Error("실행 정보가 렌더링되지 않았습니다.");
  return execution;
};

const createVideoTrack = (deviceId = "back-main", label = "Back Camera"): FakeTrack => {
  const eventTarget = new EventTarget();
  const stop = vi.fn();
  const settings: MediaTrackSettings = {
    deviceId,
    facingMode: "environment",
    width: 1920,
    height: 1080,
  };
  const capabilities: MediaTrackCapabilities = {
    deviceId,
    facingMode: ["environment"],
    width: { min: 640, max: 1920 },
    height: { min: 480, max: 1080 },
  };

  const track = {
    contentHint: "",
    enabled: true,
    id: `${deviceId}-track`,
    kind: "video",
    label,
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

const createInputDevice = (deviceId: string, label: string): InputDeviceInfo => ({
  deviceId,
  groupId: `${deviceId}-group`,
  kind: "videoinput",
  label,
  toJSON: () => ({}),
  getCapabilities: () => ({
    deviceId,
    facingMode: ["environment"],
    width: { min: 640, max: 1920 },
    height: { min: 480, max: 1080 },
  }),
});

const installBrowserBoundary = (getUserMedia: ReturnType<typeof vi.fn>) => {
  const mediaDevicesTarget = new EventTarget();
  const permissionStatusTarget = new EventTarget();
  const enumerateDevices = vi.fn().mockResolvedValue([
    createInputDevice("back-main", "Back Camera"),
    createInputDevice("back-ultra", "Back Ultra Wide Camera"),
  ]);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      ondevicechange: null,
      addEventListener: mediaDevicesTarget.addEventListener.bind(mediaDevicesTarget),
      removeEventListener: mediaDevicesTarget.removeEventListener.bind(mediaDevicesTarget),
      dispatchEvent: mediaDevicesTarget.dispatchEvent.bind(mediaDevicesTarget),
      enumerateDevices,
      getSupportedConstraints: vi.fn(() => ({})),
      getUserMedia,
    },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn().mockResolvedValue({
        state: "granted",
        onchange: null,
        addEventListener: permissionStatusTarget.addEventListener.bind(permissionStatusTarget),
        removeEventListener: permissionStatusTarget.removeEventListener.bind(permissionStatusTarget),
        dispatchEvent: permissionStatusTarget.dispatchEvent.bind(permissionStatusTarget),
      }),
    },
  });

  return { enumerateDevices };
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

describe("ToBeCameraPanel", () => {
  it("모바일 strict 모드에서 production 흐름과 검증 결과를 표시한다", async () => {
    const getUserMedia = vi.fn(async () => createMediaStream(createVideoTrack().track, `stream-${getUserMedia.mock.calls.length}`));
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);

    await user.click(screen.getByRole("checkbox", { name: "모바일 후면 카메라 강제" }));
    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));

    const preparation = await screen.findByRole("region", { name: "준비 결과" });
    expect(within(preparation).getByText("선택 사유: verified_environment")).toBeInTheDocument();
    expect(within(preparation).getByText("방향 판정: environment")).toBeInTheDocument();
    expect(within(preparation).getByText("해상도 시도: preferred")).toBeInTheDocument();
    expect(within(preparation).getByText("스트림 검증: valid")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: expect.objectContaining({
        deviceId: { exact: "back-main" },
        facingMode: { exact: "environment" },
      }),
      audio: false,
    });
  });

  it("열거한 장치의 통과 및 제외 정책을 이유와 함께 표시한다", async () => {
    const getUserMedia = vi.fn(async () => createMediaStream(createVideoTrack().track, "permission-stream"));
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));

    const decisions = await screen.findByRole("table", { name: "카메라 정책 결정" });
    expect(within(decisions).getByText("verified_environment")).toBeInTheDocument();
    expect(within(decisions).getByText("excluded_by_label")).toBeInTheDocument();
  });

  it("자동 스트림을 수동 스트림으로 넘기고 교체 및 unmount 때 현재 owner만 정리한다", async () => {
    const permissionTrack = createVideoTrack();
    const automaticTrack = createVideoTrack();
    const firstManualTrack = createVideoTrack();
    const secondManualTrack = createVideoTrack();
    let manualRequestCount = 0;
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video === true) return createMediaStream(permissionTrack.track, "permission-stream");

      const video = constraints.video as MediaTrackConstraints;
      if (video.width) return createMediaStream(automaticTrack.track, "automatic-stream");

      manualRequestCount += 1;
      return createMediaStream(manualRequestCount === 1 ? firstManualTrack.track : secondManualTrack.track, `manual-stream-${manualRequestCount}`);
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(<ToBeCameraPanel />);

    await user.click(screen.getByRole("checkbox", { name: "모바일 후면 카메라 강제" }));
    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(await screen.findByText("스트림: playing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));

    expect(automaticTrack.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(firstManualTrack.stop).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(secondManualTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("현재 자동 스트림의 video.play 거절만 hook guard를 통과해 표시한다", async () => {
    const getUserMedia = vi.fn(async () => createMediaStream(createVideoTrack().track, `stream-${getUserMedia.mock.calls.length}`));
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("automatic play rejected"));
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("checkbox", { name: "모바일 후면 카메라 강제" }));
    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("자동 스트림 video.play 실패: Error: automatic play rejected");
  });

  it("직접 재생 video.play 거절을 패널 오류 경로로 표시한다", async () => {
    const getUserMedia = vi.fn(async () => createMediaStream(createVideoTrack().track, "manual-stream"));
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("manual play rejected"));
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("직접 재생 video.play 실패: Error: manual play rejected");
  });

  it("pending 자동 요청을 정지한 뒤 시작한 manual만 owner가 되고 늦은 자동 스트림은 정리한다", async () => {
    const permissionDeferred = createDeferred<MediaStream>();
    const permissionTrack = createVideoTrack();
    const staleAutomaticTrack = createVideoTrack();
    const manualTrack = createVideoTrack();
    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      if (constraints.video === true) return permissionDeferred.promise;

      const video = constraints.video as MediaTrackConstraints;
      if (video.width) return Promise.resolve(createMediaStream(staleAutomaticTrack.track, "stale-automatic-stream"));
      return Promise.resolve(createMediaStream(manualTrack.track, "overlap-manual-stream"));
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false }));

    const stopButton = screen.getByRole("button", { name: "정지" });
    expect(stopButton).toBeEnabled();
    await user.click(stopButton);
    expect(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();
    expect(getRenderedExecution()).toHaveTextContent("overlap-manual-stream");

    await act(async () => {
      permissionDeferred.resolve(createMediaStream(permissionTrack.track, "late-permission-stream"));
      await permissionDeferred.promise;
    });

    await waitFor(() => expect(staleAutomaticTrack.stop).toHaveBeenCalledTimes(1));
    expect(permissionTrack.stop).toHaveBeenCalledTimes(1);
    expect(getRenderedExecution()).toHaveTextContent("overlap-manual-stream");
    expect(getRenderedExecution()).not.toHaveTextContent("stale-automatic-stream");
    expect(manualTrack.stop).not.toHaveBeenCalled();
  });

  it("active 및 pending manual을 정지하고 replacement의 늦은 스트림을 owner로 채택하지 않는다", async () => {
    const activeTrack = createVideoTrack();
    const replacementTrack = createVideoTrack();
    const replacementDeferred = createDeferred<MediaStream>();
    let manualRequestCount = 0;
    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      const video = constraints.video as MediaTrackConstraints;
      if (!video.deviceId || video.width) return Promise.resolve(createMediaStream(createVideoTrack().track, "unused-stream"));

      manualRequestCount += 1;
      return manualRequestCount === 1
        ? Promise.resolve(createMediaStream(activeTrack.track, "active-manual-stream"))
        : replacementDeferred.promise;
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();
    expect(getRenderedExecution()).toHaveTextContent("active-manual-stream");

    await user.click(screen.getByRole("button", { name: "정지" }));
    expect(activeTrack.stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("스트림: stopped")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    await act(async () => {
      replacementDeferred.resolve(createMediaStream(replacementTrack.track, "replacement-manual-stream"));
      await replacementDeferred.promise;
    });
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();
    expect(getRenderedExecution()).toHaveTextContent("replacement-manual-stream");

    const staleReplacementTrack = createVideoTrack();
    const staleReplacementDeferred = createDeferred<MediaStream>();
    getUserMedia.mockImplementationOnce(() => staleReplacementDeferred.promise);
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(replacementTrack.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "정지" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "정지" }));
    expect(await screen.findByText("스트림: stopped")).toBeInTheDocument();

    await act(async () => {
      staleReplacementDeferred.resolve(createMediaStream(staleReplacementTrack.track, "stale-replacement-stream"));
      await staleReplacementDeferred.promise;
    });

    await waitFor(() => expect(staleReplacementTrack.stop).toHaveBeenCalledTimes(1));
    expect(screen.getByText("스트림: stopped")).toBeInTheDocument();
    expect(getRenderedExecution()).not.toHaveTextContent("stale-replacement-stream");
  });

  it("automatic replacement 중 unmount하면 현재 및 늦게 획득한 스트림을 모두 정리한다", async () => {
    const firstPermissionTrack = createVideoTrack();
    const firstAutomaticTrack = createVideoTrack();
    const secondPermissionTrack = createVideoTrack();
    const secondAutomaticTrack = createVideoTrack();
    const secondPermissionDeferred = createDeferred<MediaStream>();
    let permissionCount = 0;
    let automaticCount = 0;
    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      if (constraints.video === true) {
        permissionCount += 1;
        return permissionCount === 1
          ? Promise.resolve(createMediaStream(firstPermissionTrack.track, "first-permission-stream"))
          : secondPermissionDeferred.promise;
      }

      automaticCount += 1;
      return Promise.resolve(
        createMediaStream(automaticCount === 1 ? firstAutomaticTrack.track : secondAutomaticTrack.track, `automatic-stream-${automaticCount}`),
      );
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(<ToBeCameraPanel />);

    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(await screen.findByText("스트림: playing")).toBeInTheDocument();
    expect(getRenderedExecution()).toHaveTextContent("automatic-stream-1");
    expect(firstPermissionTrack.stop).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(firstAutomaticTrack.stop).toHaveBeenCalledTimes(1);
    view.unmount();

    await act(async () => {
      secondPermissionDeferred.resolve(createMediaStream(secondPermissionTrack.track, "second-permission-stream"));
      await secondPermissionDeferred.promise;
    });

    await waitFor(() => expect(secondAutomaticTrack.stop).toHaveBeenCalledTimes(1));
    expect(secondPermissionTrack.stop).toHaveBeenCalledTimes(1);
  });
});
