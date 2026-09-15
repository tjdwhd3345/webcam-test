import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdcardCameraError } from "@tobe/domain/camera/camera_errors";
import { PrepareIdcardCameraStream } from "@tobe/domain/camera/prepare_idcard_camera_stream";
import { idcardCameraConsoleLogger } from "@tobe/infrastructure/camera/idcard_camera_console_logger";
import { MediaDevicesCameraGateway } from "@tobe/infrastructure/camera/media_devices_camera_gateway";

const { mockExecute, mockGateway, mockStopStream } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockStopStream = vi.fn();

  return {
    mockExecute,
    mockStopStream,
    mockGateway: { stopStream: mockStopStream },
  };
});

vi.mock("@tobe/infrastructure/camera/media_devices_camera_gateway", () => ({
  MediaDevicesCameraGateway: vi.fn().mockImplementation(function MockMediaDevicesCameraGateway() {
    return mockGateway;
  }),
}));

vi.mock("@tobe/domain/camera/prepare_idcard_camera_stream", () => ({
  PrepareIdcardCameraStream: vi.fn().mockImplementation(function MockPrepareIdcardCameraStream() {
    return { execute: mockExecute };
  }),
}));

type MockMediaStreamTrack = MediaStreamTrack & {
  emitEnded: () => void;
  emitMute: () => void;
};

type MockMediaStream = MediaStream & {
  mockTrack: MockMediaStreamTrack;
};

const hookModulePath = "../useIdcardCameraStream";
const loadUseIdcardCameraStream = async () => (await import(/* @vite-ignore */ hookModulePath)).useIdcardCameraStream;

const createStream = () => {
  let readyState: MediaStreamTrackState = "live";
  let muted = false;
  const listeners = new Map<string, EventListenerOrEventListenerObject[]>();

  const track = {
    get readyState() {
      return readyState;
    },
    get muted() {
      return muted;
    },
    stop: vi.fn(() => {
      readyState = "ended";
    }),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((registeredListener) => registeredListener !== listener),
      );
    }),
    emitEnded: () => {
      readyState = "ended";
      const event = new Event("ended");
      for (const listener of listeners.get("ended") || []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
    emitMute: () => {
      muted = true;
      const event = new Event("mute");
      for (const listener of listeners.get("mute") || []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    },
  } as unknown as MockMediaStreamTrack;

  return {
    mockTrack: track,
    getTracks: vi.fn(() => [track]),
    getVideoTracks: vi.fn(() => [track]),
  } as unknown as MockMediaStream;
};

const createResult = () => {
  const stream = createStream();

  return {
    stream,
    selectedDevice: { deviceId: "main", label: "Back Camera", facingMode: "environment" as const },
    actualSettings: { deviceId: "main", facingMode: "environment", width: 1920, height: 1080 },
    resolutionAttempt: "preferred" as const,
    selectionReason: "verified_environment" as const,
    facingAssessment: "environment" as const,
  };
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const setVisibilityState = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
};

describe("useIdcardCameraStream", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
    setVisibilityState("visible");
  });

  it("gateway/usecase를 mount당 한 번만 lazy 생성하고 logger를 주입한다", async () => {
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result, rerender } = renderHook(() => useIdcardCameraStream());
    const firstRecordVideoPlayFailure = result.current.recordVideoPlayFailure;

    rerender();

    expect(MediaDevicesCameraGateway).toHaveBeenCalledTimes(1);
    expect(MediaDevicesCameraGateway).toHaveBeenCalledWith(undefined, idcardCameraConsoleLogger);
    expect(PrepareIdcardCameraStream).toHaveBeenCalledTimes(1);
    expect(PrepareIdcardCameraStream).toHaveBeenCalledWith(mockGateway, undefined, undefined, idcardCameraConsoleLogger);
    expect(result.current.recordVideoPlayFailure).toBe(firstRecordVideoPlayFailure);
  });

  it("prepare 성공 시 stream/state/result를 업데이트한다", async () => {
    const prepared = createResult();
    mockExecute.mockResolvedValueOnce(prepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());

    await act(async () => {
      await expect(result.current.prepareStream({ target: "idcard_front" })).resolves.toBe(prepared);
    });

    expect(mockExecute).toHaveBeenCalledWith({ target: "idcard_front" });
    expect(result.current.stream).toBe(prepared.stream);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.selectedDevice).toEqual(prepared.selectedDevice);
    expect(result.current.actualSettings).toEqual(prepared.actualSettings);
    expect(result.current.resolutionAttempt).toBe("preferred");
  });

  it("stop 시 stream cleanup 상태로 전환한다", async () => {
    const prepared = createResult();
    mockExecute.mockResolvedValueOnce(prepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());

    await act(async () => {
      await result.current.prepareStream({ target: "idcard_front" });
    });

    act(() => {
      result.current.stopStream();
    });

    expect(mockStopStream).toHaveBeenCalledWith(prepared.stream);
    expect(result.current.stream).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.selectedDevice).toBeNull();
    expect(result.current.actualSettings).toBeNull();
    expect(result.current.resolutionAttempt).toBeNull();
  });

  it("중복 prepare 요청은 진행 중인 promise를 재사용한다", async () => {
    let resolvePrepare: (value: ReturnType<typeof createResult>) => void = () => {};
    const prepared = createResult();
    mockExecute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrepare = resolve;
        }),
    );
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());
    let firstPromise: Promise<unknown>;
    let secondPromise: Promise<unknown>;
    const firstInput = { target: "idcard_front", requireEnvironmentCamera: true } as const;

    act(() => {
      firstPromise = result.current.prepareStream(firstInput);
      secondPromise = result.current.prepareStream({ target: "idcard_back", requireEnvironmentCamera: false });
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(firstInput);

    await act(async () => {
      resolvePrepare(prepared);
      await expect(firstPromise!).resolves.toBe(prepared);
      await expect(secondPromise!).resolves.toBe(prepared);
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("play 실패가 현재 준비된 stream에 속하는지 식별하고 stale/stop 실패는 무시한다", async () => {
    const stalePrepared = createResult();
    const currentPrepared = createResult();
    const staleInput = { target: "idcard_front", requireEnvironmentCamera: true } as const;
    const currentInput = { target: "idcard_back", requireEnvironmentCamera: true } as const;
    mockExecute.mockResolvedValueOnce(stalePrepared).mockResolvedValueOnce(currentPrepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());

    expect(result.current.recordVideoPlayFailure(new Error("before prepare"))).toBe(false);

    await act(async () => {
      await result.current.prepareStream(staleInput);
      await result.current.prepareStream(currentInput);
    });

    const currentStream = currentPrepared.stream;
    const staleStream = stalePrepared.stream;

    expect(result.current.recordVideoPlayFailure(new Error("play failed"), currentStream)).toBe(true);
    expect(result.current.recordVideoPlayFailure(new Error("stale"), staleStream)).toBe(false);

    act(() => result.current.stopStream());
    expect(result.current.recordVideoPlayFailure(new Error("stopped"), currentStream)).toBe(false);
  });

  it("unmount 시 stream을 cleanup한다", async () => {
    const prepared = createResult();
    mockExecute.mockResolvedValueOnce(prepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result, unmount } = renderHook(() => useIdcardCameraStream());

    await act(async () => {
      await result.current.prepareStream({ target: "idcard_front" });
    });

    unmount();

    expect(mockStopStream).toHaveBeenCalledWith(prepared.stream);
  });

  it("prepare 실패 시 error 상태를 업데이트한다", async () => {
    const cameraError = new IdcardCameraError("camera_permission_denied");
    mockExecute.mockRejectedValueOnce(cameraError);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());

    await act(async () => {
      await expect(result.current.prepareStream({ target: "idcard_front" })).rejects.toBe(cameraError);
      await flushPromises();
    });

    expect(result.current.stream).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe(cameraError);
  });

  it("pagehide 이후 pageshow만 발생해도 마지막 입력으로 스트림을 재준비한다", async () => {
    const initialPrepared = createResult();
    const recoveredPrepared = createResult();
    mockExecute.mockResolvedValueOnce(initialPrepared).mockResolvedValueOnce(recoveredPrepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());
    const input = { target: "idcard_front", requireEnvironmentCamera: true } as const;

    await act(async () => {
      await result.current.prepareStream(input);
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
      await flushPromises();
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenLastCalledWith(input);
    expect(mockStopStream).toHaveBeenCalledWith(initialPrepared.stream);
    expect(result.current.stream).toBe(recoveredPrepared.stream);
  });

  it("hidden 상태에서 트랙이 종료되면 visible 복귀 시 스트림을 재준비한다", async () => {
    const initialPrepared = createResult();
    const recoveredPrepared = createResult();
    mockExecute.mockResolvedValueOnce(initialPrepared).mockResolvedValueOnce(recoveredPrepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());
    const input = { target: "idcard_back", requireEnvironmentCamera: true } as const;

    await act(async () => {
      await result.current.prepareStream(input);
    });

    setVisibilityState("hidden");
    await act(async () => {
      initialPrepared.stream.mockTrack.emitEnded();
      await flushPromises();
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);

    setVisibilityState("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flushPromises();
    });

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenLastCalledWith(input);
    expect(result.current.stream).toBe(recoveredPrepared.stream);
  });

  it("stopStream 이후에는 페이지 복귀 이벤트가 발생해도 스트림을 재준비하지 않는다", async () => {
    const prepared = createResult();
    mockExecute.mockResolvedValue(prepared);
    const useIdcardCameraStream = await loadUseIdcardCameraStream();
    const { result } = renderHook(() => useIdcardCameraStream());

    await act(async () => {
      await result.current.prepareStream({ target: "idcard_front" });
    });

    act(() => {
      result.current.stopStream();
    });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
      await flushPromises();
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
