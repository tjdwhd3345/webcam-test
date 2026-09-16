import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToBeCameraPanel } from "../ToBeCameraPanel";
import { AsIsCameraPanel } from "../AsIsCameraPanel";

const originalMediaDevices = navigator.mediaDevices;
const originalPermissions = navigator.permissions;

type FakeTrack = {
  track: MediaStreamTrack;
  stop: ReturnType<typeof vi.fn>;
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
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
  it("권한 prompt에서 bootstrap을 요청하고 정리한 다음 권한 상태를 표시한다", async () => {
    const permissionTrack = createVideoTrack();
    let permission: PermissionState = "prompt";
    const getUserMedia = vi.fn(async () => {
      permission = "granted";
      return createMediaStream(permissionTrack.track, "permission-bootstrap");
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(navigator.permissions, "query").mockImplementation(async () => ({ state: permission }) as PermissionStatus);
    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 권한" }));
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(permissionTrack.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("권한: granted")).toBeInTheDocument();
  });

  it("장치 목록 조회는 prompt 권한을 먼저 획득하고 bootstrap을 정리한 뒤 열거한다", async () => {
    const bootstrapTrack = createVideoTrack();
    const getUserMedia = vi.fn(async () => createMediaStream(bootstrapTrack.track, "enumeration-bootstrap"));
    const { enumerateDevices } = installBrowserBoundary(getUserMedia);
    vi.spyOn(navigator.permissions, "query").mockResolvedValue({ state: "prompt" } as PermissionStatus);

    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(bootstrapTrack.stop).toHaveBeenCalledTimes(1);
    expect(enumerateDevices).toHaveBeenCalledAfter(getUserMedia);
  });

  it("빈 deviceId만 열거되면 직접 재생을 비활성화한다", async () => {
    const { enumerateDevices } = installBrowserBoundary(vi.fn());
    enumerateDevices.mockResolvedValue([createInputDevice("", "Hidden Camera")]);

    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));

    expect(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" })).toBeDisabled();
  });

  it("직접 재생 직전에 선택한 장치를 다시 열거하고 현재 exact ID를 연다", async () => {
    const manualTrack = createVideoTrack();
    const getUserMedia = vi.fn(async () => createMediaStream(manualTrack.track, "current-manual-stream"));
    const { enumerateDevices } = installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await userEvent.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));

    expect(enumerateDevices).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: expect.objectContaining({ deviceId: { exact: "back-main" } }),
      audio: false,
    });
  });

  it("직접 재생 전 새 목록에 선택 ID가 없으면 재조회를 안내하고 stale exact 요청을 보내지 않는다", async () => {
    const getUserMedia = vi.fn(async () => createMediaStream(createVideoTrack().track, "unexpected-manual-stream"));
    const { enumerateDevices } = installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    enumerateDevices
      .mockResolvedValueOnce([createInputDevice("back-main", "Back Camera")])
      .mockResolvedValueOnce([createInputDevice("back-replacement", "Replacement Back Camera")]);

    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await userEvent.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("camera_not_found");
    expect(alert).toHaveTextContent("카메라 목록을 다시 조회");
    expect(getUserMedia).not.toHaveBeenCalledWith({
      video: expect.objectContaining({ deviceId: { exact: "back-main" } }),
      audio: false,
    });
  });

  it.each(["permission", "enumeration"])("%s 진단은 기존 owner를 먼저 해제하여 probe와 겹치지 않는다", async (action) => {
    const live = new Set<MediaStreamTrack>();
    let peak = 0;
    const getUserMedia = vi.fn(async () => {
      const { track, stop } = createVideoTrack();
      live.add(track);
      peak = Math.max(peak, live.size);
      stop.mockImplementation(() => live.delete(track));
      return createMediaStream(track, `stream-${getUserMedia.mock.calls.length}`);
    });
    const { enumerateDevices } = installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const view = render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(await screen.findByRole("region", { name: "준비 결과" })).toBeInTheDocument();
    // Legacy InputDeviceInfo forces the real gateway to open capability probes.
    enumerateDevices.mockResolvedValue([{ deviceId: "back-main", kind: "videoinput", label: "Back Camera", groupId: "back", toJSON: () => ({}) }]);
    await userEvent.click(screen.getByRole("button", { name: action === "permission" ? "카메라 권한" : "카메라 목록 조회" }));
    expect(peak).toBe(1);
    expect(live.size).toBe(0);
    expect(screen.queryByRole("region", { name: "준비 결과" })).not.toBeInTheDocument();
    expect(screen.getByText("실행: -")).toBeInTheDocument();
    view.unmount();
    expect(live.size).toBe(0);
  });

  it.each(["permission", "manual", "enumeration"])("%s의 브라우저 거절을 도메인 오류로 표시한다", async (action) => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("blocked by browser", "NotAllowedError"));
    const { enumerateDevices } = installBrowserBoundary(getUserMedia);
    render(<ToBeCameraPanel />);
    if (action === "manual") await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    if (action === "enumeration") enumerateDevices.mockRejectedValue(new DOMException("blocked by browser", "NotAllowedError"));
    await userEvent.click(screen.getByRole("button", { name: action === "manual" ? "선택 장치 직접 재생 (진단)" : action === "permission" ? "카메라 권한" : "카메라 목록 조회" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("camera_permission_denied");
  });

  it("manual 스트림의 settings 조회가 실패하면 열린 스트림을 정리하고 도메인 오류를 표시한다", async () => {
    const { track, stop } = createVideoTrack();
    vi.mocked(track.getSettings).mockImplementation(() => { throw new DOMException("settings unavailable", "NotReadableError"); });
    installBrowserBoundary(vi.fn(async () => createMediaStream(track, "unreadable-manual")));
    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await userEvent.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("camera_not_readable");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("스트림: stopped")).toBeInTheDocument();
  });

  it.each(["denied", "replaced"])("복구 중 loading을 표시하고 %s 후 이전 준비 결과를 제거한다", async (outcome) => {
    const recovery = createDeferred<MediaStream>();
    let calls = 0;
    const getUserMedia = vi.fn(() => {
      calls += 1;
      return calls === 3 ? recovery.promise : Promise.resolve(createMediaStream(createVideoTrack().track, `stream-${calls}`));
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(await screen.findByRole("region", { name: "준비 결과" })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await waitFor(() => expect(calls).toBe(3));
    expect(screen.getByRole("button", { name: "카메라 목록 조회" })).toBeDisabled();
    expect(screen.getByText("스트림: loading")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "준비 결과" })).not.toBeInTheDocument();
    await act(async () => {
      if (outcome === "denied") recovery.reject(new DOMException("recovery denied", "NotAllowedError"));
      else recovery.resolve(createMediaStream(createVideoTrack().track, "recovery-bootstrap"));
      await Promise.resolve();
    });
    if (outcome === "denied") {
      expect(await screen.findByRole("alert")).toHaveTextContent("camera_permission_denied");
      expect(screen.getByText("실행: -")).toBeInTheDocument();
    } else expect(await screen.findByText("스트림: playing")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "준비 결과" })).not.toBeInTheDocument();
  });

  it("정지한 장치 조회의 늦은 결과가 정책 표나 장치 목록으로 돌아오지 않는다", async () => {
    const enumeration = createDeferred<MediaDeviceInfo[]>();
    const { enumerateDevices } = installBrowserBoundary(vi.fn());
    enumerateDevices.mockReturnValue(enumeration.promise);
    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    expect(screen.getByRole("button", { name: "정지" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "정지" }));
    await act(async () => {
      enumeration.resolve([createInputDevice("late", "Late Camera")]);
      await enumeration.promise;
    });
    expect(screen.queryByRole("table", { name: "카메라 정책 결정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Late Camera/ })).not.toBeInTheDocument();
  });

  it("AS-IS hook이 삼킨 권한 거절을 화면에 표시하며 owner로 표시하지 않는다", async () => {
    installBrowserBoundary(vi.fn().mockRejectedValue(new DOMException("blocked", "NotAllowedError")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AsIsCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("NotAllowedError");
    expect(screen.getByText("실행: -")).toBeInTheDocument();
  });

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
        facingMode: { ideal: "environment" },
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
    const rows = within(decisions).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Back Camera");
    expect(rows[1]).toHaveTextContent("environment");
    expect(rows[1]).toHaveTextContent("PASS");
    expect(rows[1]).toHaveTextContent("verified_environment");
    expect(rows[2]).toHaveTextContent("Back Ultra Wide Camera");
    expect(rows[2]).toHaveTextContent("environment");
    expect(rows[2]).toHaveTextContent("FAIL");
    expect(rows[2]).toHaveTextContent("excluded_by_label");
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
    const manualValidation = screen.getByRole("region", { name: "직접 재생 검증" });
    expect(within(manualValidation).getByText("valid")).toBeInTheDocument();
    expect(manualValidation).toHaveTextContent('"deviceId": "back-main"');
    expect(manualValidation).toHaveTextContent('"facingMode": "environment"');
    expect(manualValidation).toHaveTextContent('"width": 1920');
    expect(manualValidation).toHaveTextContent('"height": 1080');
    const settingsSection = screen.getByRole("heading", { name: "settings" }).closest("section");
    expect(settingsSection).toHaveTextContent('"deviceId": "back-main"');
    expect(settingsSection).toHaveTextContent('"width": 1920');
    expect(settingsSection).toHaveTextContent('"height": 1080');

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

  it("교체된 자동 스트림의 늦은 video.play 거절을 표시하지 않는다", async () => {
    const automaticPlay = createDeferred<void>();
    const automaticTrack = createVideoTrack();
    const manualTrack = createVideoTrack();
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video === true) return createMediaStream(createVideoTrack().track, "permission-stream");

      const video = constraints.video as MediaTrackConstraints;
      return video.width
        ? createMediaStream(automaticTrack.track, "stale-automatic-stream")
        : createMediaStream(manualTrack.track, "current-manual-stream");
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => automaticPlay.promise)
      .mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("checkbox", { name: "모바일 후면 카메라 강제" }));
    await user.click(screen.getByRole("button", { name: "후면 카메라 실행" }));
    expect(await screen.findByText("실행: rear")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();

    await act(async () => {
      automaticPlay.reject(new Error("stale automatic play rejected"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getRenderedExecution()).toHaveTextContent("current-manual-stream");
  });

  it("교체된 수동 스트림의 늦은 video.play 거절을 표시하지 않는다", async () => {
    const firstManualPlay = createDeferred<void>();
    const firstManualTrack = createVideoTrack();
    const secondManualTrack = createVideoTrack();
    let manualRequestCount = 0;
    const getUserMedia = vi.fn(async () => {
      manualRequestCount += 1;
      return createMediaStream(
        manualRequestCount === 1 ? firstManualTrack.track : secondManualTrack.track,
        `manual-stream-${manualRequestCount}`,
      );
    });
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => firstManualPlay.promise)
      .mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ToBeCameraPanel />);
    await user.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    await waitFor(() => expect(getRenderedExecution()).toHaveTextContent("manual-stream-2"));

    await act(async () => {
      firstManualPlay.reject(new Error("stale manual play rejected"));
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getRenderedExecution()).toHaveTextContent("manual-stream-2");
  });

  it("pending 자동 요청을 정지하면 정리가 끝난 뒤 manual을 열고 늦은 자동 결과는 버린다", async () => {
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
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByText("스트림: stopped")).toBeInTheDocument();

    await act(async () => {
      permissionDeferred.resolve(createMediaStream(permissionTrack.track, "late-permission-stream"));
      await permissionDeferred.promise;
    });

    await waitFor(() => expect(staleAutomaticTrack.stop).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();
    expect(permissionTrack.stop).toHaveBeenCalledTimes(1);
    expect(getRenderedExecution()).toHaveTextContent("overlap-manual-stream");
    expect(getRenderedExecution()).not.toHaveTextContent("stale-automatic-stream");
    expect(manualTrack.stop).not.toHaveBeenCalled();
  });

  it("늦은 permission bootstrap을 정지하면 정리 후 다음 manual을 열고 권한 결과는 버린다", async () => {
    const permission = createDeferred<MediaStream>();
    const bootstrap = createVideoTrack();
    const manual = createVideoTrack();
    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => constraints.video === true
      ? permission.promise
      : Promise.resolve(createMediaStream(manual.track, "after-bootstrap")));
    installBrowserBoundary(getUserMedia);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<ToBeCameraPanel />);
    await userEvent.click(screen.getByRole("button", { name: "카메라 목록 조회" }));
    await userEvent.click(screen.getByRole("button", { name: "카메라 권한" }));
    await userEvent.click(screen.getByRole("button", { name: "정지" }));
    await userEvent.click(screen.getByRole("button", { name: "선택 장치 직접 재생 (진단)" }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      permission.resolve(createMediaStream(bootstrap.track, "late-bootstrap"));
      await permission.promise;
    });
    expect(await screen.findByText("실행: selected")).toBeInTheDocument();
    expect(bootstrap.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("권한: unknown")).toBeInTheDocument();
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
