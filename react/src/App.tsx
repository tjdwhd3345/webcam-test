import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IdcardCameraError, mapBrowserErrorToIdcardCameraError } from "./domain/camera/camera_errors.ts";
import { PrepareIdcardCameraStream } from "./domain/camera/prepare_idcard_camera_stream.ts";
import { MediaDevicesCameraGateway } from "./infrastructure/camera/media_devices_camera_gateway.ts";
import { useCameraStream } from "./hook/useCameraStream.ts";
import type { CameraDeviceInfo, CameraFacingMode, CameraStreamOptions } from "./types/camera.ts";
import "./App.css";

type WorkbenchMode = "as-is" | "to-be";
type CameraAction = "permission" | "rear" | "devices" | "selected" | null;
type StreamOwner = "rear" | "selected" | null;

type RawMediaDevice = {
  deviceId: string;
  groupId: string;
  kind: MediaDeviceKind;
  label: string;
  facingMode?: CameraFacingMode;
  capabilities?: MediaTrackCapabilities;
};

type StreamSnapshot = {
  active: boolean;
  id?: string;
  tracks: Array<{
    id: string;
    kind: string;
    label: string;
    enabled: boolean;
    muted: boolean;
    readyState: MediaStreamTrackState;
    settings: MediaTrackSettings;
    capabilities?: MediaTrackCapabilities;
  }>;
};

type PanelStatus = {
  permission: PermissionState | "unknown";
  action: CameraAction;
  owner: StreamOwner;
  error: string | null;
  selectedDeviceId: string;
  mediaDevices: RawMediaDevice[];
  requestInfo: Record<string, unknown> | null;
};

type ToBeState = {
  stream: MediaStream | null;
  selectedDevice: CameraDeviceInfo | null;
  actualSettings: MediaTrackSettings | null;
  resolutionAttempt: "preferred" | "fallback" | null;
  isStreaming: boolean;
};

const IDCARD_CAMERA_OPTIONS: CameraStreamOptions = {
  video: {
    facingMode: "environment",
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    focusMode: "continuous",
    whiteBalanceMode: "continuous",
    zoom: { ideal: 1 },
  },
  audio: false,
  retryCount: 3,
  retryDelay: 1000,
};

const emptySnapshot: StreamSnapshot = {
  active: false,
  tracks: [],
};

const getMediaDevices = (): MediaDevices => {
  if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("MediaDevices API is not supported.");
  }

  return navigator.mediaDevices;
};

const stopMediaStream = (stream: MediaStream | null | undefined): void => {
  stream?.getTracks().forEach((track) => track.stop());
};

const resolveFacingMode = (label: string, facingModes?: string[]): CameraFacingMode | undefined => {
  if (facingModes?.includes("environment")) return "environment";
  if (facingModes?.includes("user")) return "user";
  if (/back|rear|environment|후면/i.test(label)) return "environment";
  if (/front|user|전면/i.test(label)) return "user";
  return undefined;
};

const getDeviceCapabilities = (device: MediaDeviceInfo): MediaTrackCapabilities | undefined => {
  const input = device as MediaDeviceInfo & { getCapabilities?: () => MediaTrackCapabilities };
  return typeof input.getCapabilities === "function" ? input.getCapabilities() : undefined;
};

const toRawMediaDevice = (device: MediaDeviceInfo): RawMediaDevice => {
  const capabilities = device.kind === "videoinput" ? getDeviceCapabilities(device) : undefined;

  return {
    deviceId: device.deviceId,
    groupId: device.groupId,
    kind: device.kind,
    label: device.label || "(label hidden until permission is granted)",
    facingMode: resolveFacingMode(device.label, capabilities?.facingMode),
    capabilities,
  };
};

const requestCameraPermission = async (): Promise<PermissionState | "unknown"> => {
  const stream = await getMediaDevices().getUserMedia({ video: true, audio: false });
  stopMediaStream(stream);

  if (!navigator.permissions?.query) return "unknown";

  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
};

const loadAllMediaDevices = async (): Promise<RawMediaDevice[]> => {
  const devices = await getMediaDevices().enumerateDevices();
  return devices.map(toRawMediaDevice);
};

const getVideoInputDevices = (devices: RawMediaDevice[]): RawMediaDevice[] => devices.filter((device) => device.kind === "videoinput");

const getRuntimeCapabilities = () => ({
  isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
  getUserMedia: typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
});

const getStreamSnapshot = (stream: MediaStream | null): StreamSnapshot => {
  if (!stream) return emptySnapshot;

  return {
    active: stream.active,
    id: stream.id,
    tracks: stream.getTracks().map((track) => ({
      id: track.id,
      kind: track.kind,
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      settings: track.getSettings?.() ?? {},
      capabilities: track.getCapabilities?.(),
    })),
  };
};

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2);

const formatDeviceResolution = (device: RawMediaDevice): string => {
  const width = device.capabilities?.width;
  const height = device.capabilities?.height;

  if (typeof width?.max === "number" && typeof height?.max === "number") {
    return `max ${width.max} x ${height.max}`;
  }

  return "-";
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof IdcardCameraError) return `${error.code}: ${error.message}`;
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return `${String((error as { code: unknown }).code)}: ${String((error as { message: unknown }).message)}`;
  }
  if (error && typeof error === "object" && "type" in error && "message" in error) {
    return `${String((error as { type: unknown }).type)}: ${String((error as { message: unknown }).message)}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown camera error";
};

const toExactDeviceConstraints = (device: RawMediaDevice): MediaStreamConstraints => ({
  video: {
    deviceId: { exact: device.deviceId },
    ...(device.facingMode ? { facingMode: { ideal: device.facingMode } } : {}),
  },
  audio: false,
});

const toAsIsDeviceOptions = (device: RawMediaDevice): CameraStreamOptions => ({
  video: {
    deviceId: device.deviceId,
    ...(device.facingMode ? { facingMode: device.facingMode } : {}),
  },
  audio: false,
  retryCount: 1,
});

const asDeviceInfo = (device: RawMediaDevice | null): CameraDeviceInfo | null => {
  if (!device || device.kind !== "videoinput") return null;

  return {
    deviceId: device.deviceId,
    label: device.label,
    facingMode: device.facingMode,
    capabilities: device.capabilities,
  };
};

const createRearRequestInfo = (mode: WorkbenchMode): Record<string, unknown> => {
  if (mode === "to-be") {
    return {
      mode,
      action: "rear-camera",
      usecase: "PrepareIdcardCameraStream",
      input: { target: "idcard_front" },
      policy: {
        preferredFacingMode: "environment",
        preferredResolution: "1920x1080",
        fallbackResolution: "1280x720",
      },
    };
  }

  return {
    mode,
    action: "rear-camera",
    options: IDCARD_CAMERA_OPTIONS,
  };
};

const createSelectedDeviceRequestInfo = (mode: WorkbenchMode, device: RawMediaDevice): Record<string, unknown> => ({
  mode,
  action: "selected-device",
  selectedDevice: {
    deviceId: device.deviceId,
    label: device.label,
    resolution: formatDeviceResolution(device),
  },
  constraints: mode === "to-be" ? toExactDeviceConstraints(device) : toAsIsDeviceOptions(device),
});

const getStreamSummary = (snapshot: StreamSnapshot) => ({
  active: snapshot.active,
  id: snapshot.id,
  tracks: snapshot.tracks.map((track) => ({
    id: track.id,
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  })),
});

const getStreamSettings = (snapshot: StreamSnapshot) =>
  snapshot.tracks.map((track) => ({
    id: track.id,
    label: track.label,
    settings: track.settings,
  }));

const getStreamCapabilities = (snapshot: StreamSnapshot) =>
  snapshot.tracks.map((track) => ({
    id: track.id,
    label: track.label,
    capabilities: track.capabilities ?? null,
  }));

function useVideoElement(stream: MediaStream | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return videoRef;
}

function usePanelStatus() {
  const [status, setStatus] = useState<PanelStatus>({
    permission: "unknown",
    action: null,
    owner: null,
    error: null,
    selectedDeviceId: "",
    mediaDevices: [],
    requestInfo: null,
  });

  const patchStatus = useCallback((updates: Partial<PanelStatus>) => {
    setStatus((previous) => ({ ...previous, ...updates }));
  }, []);

  return [status, patchStatus] as const;
}

function useToBeWorkbench() {
  const [gateway] = useState(() => new MediaDevicesCameraGateway());
  const [usecase] = useState(() => new PrepareIdcardCameraStream(gateway));
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<ToBeState>({
    stream: null,
    selectedDevice: null,
    actualSettings: null,
    resolutionAttempt: null,
    isStreaming: false,
  });

  const stopStream = useCallback(() => {
    gateway.stopStream(streamRef.current);
    streamRef.current = null;
    setState({
      stream: null,
      selectedDevice: null,
      actualSettings: null,
      resolutionAttempt: null,
      isStreaming: false,
    });
  }, [gateway]);

  const prepareRearStream = useCallback(async () => {
    stopStream();
    const result = await usecase.execute({ target: "idcard_front" });
    streamRef.current = result.stream;
    setState({
      stream: result.stream,
      selectedDevice: result.selectedDevice,
      actualSettings: result.actualSettings,
      resolutionAttempt: result.resolutionAttempt,
      isStreaming: true,
    });
  }, [stopStream, usecase]);

  const playSelectedDevice = useCallback(
    async (device: RawMediaDevice) => {
      stopStream();
      const stream = await gateway.openStream(toExactDeviceConstraints(device));
      const track = stream.getVideoTracks()[0];
      streamRef.current = stream;
      setState({
        stream,
        selectedDevice: asDeviceInfo(device),
        actualSettings: track?.getSettings?.() ?? null,
        resolutionAttempt: null,
        isStreaming: true,
      });
    },
    [gateway, stopStream],
  );

  useEffect(() => stopStream, [stopStream]);

  return {
    ...state,
    prepareRearStream,
    playSelectedDevice,
    stopStream,
  };
}

function DeviceSelect({
  devices,
  selectedDeviceId,
  disabled,
  onChange,
}: {
  devices: RawMediaDevice[];
  selectedDeviceId: string;
  disabled: boolean;
  onChange: (deviceId: string) => void;
}) {
  const videoDevices = getVideoInputDevices(devices);

  return (
    <label className="field">
      <span>선택 재생 장치</span>
      <select value={selectedDeviceId} onChange={(event) => onChange(event.target.value)} disabled={disabled || videoDevices.length === 0}>
        <option value="">카메라 선택</option>
        {videoDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label} / {device.facingMode ?? "unknown"}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusStrip({
  permission,
  stream,
  owner,
  selectedDevice,
  resolutionAttempt,
}: {
  permission: PermissionState | "unknown";
  stream: MediaStream | null;
  owner: StreamOwner;
  selectedDevice: CameraDeviceInfo | null;
  resolutionAttempt?: string | null;
}) {
  const settings = stream?.getVideoTracks()[0]?.getSettings?.();
  const resolution = settings?.width && settings.height ? `${settings.width}x${settings.height}` : "-";

  return (
    <div className="status-grid" aria-live="polite">
      <span>권한: {permission}</span>
      <span>스트림: {stream ? "playing" : "stopped"}</span>
      <span>실행: {owner ?? "-"}</span>
      <span>해상도: {resolution}</span>
      <span>시도: {resolutionAttempt ?? "-"}</span>
      <span>장치: {selectedDevice?.label ?? "-"}</span>
    </div>
  );
}

function MediaDeviceList({ devices, selectedDeviceId }: { devices: RawMediaDevice[]; selectedDeviceId: string }) {
  const videoDevices = getVideoInputDevices(devices);

  if (videoDevices.length === 0) {
    return <p className="empty-state">카메라 목록 조회를 실행하면 접근 가능한 미디어 장치가 표시됩니다.</p>;
  }

  return (
    <div className="device-list">
      {videoDevices.map((device) => (
        <article className={device.deviceId === selectedDeviceId ? "device-row selected" : "device-row"} key={`${device.kind}-${device.deviceId || device.label}`}>
          <div>
            <strong>{device.label}</strong>
            <span>{device.kind}</span>
          </div>
          <dl>
            <div>
              <dt>label</dt>
              <dd>{device.label}</dd>
            </div>
            <div>
              <dt>deviceId</dt>
              <dd>{device.deviceId || "-"}</dd>
            </div>
            <div>
              <dt>해상도</dt>
              <dd>{formatDeviceResolution(device)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function StreamPreview({
  stream,
  label,
}: {
  stream: MediaStream | null;
  label: string;
}) {
  const videoRef = useVideoElement(stream);

  return (
    <div className="preview-panel">
      <video ref={videoRef} playsInline muted autoPlay />
      {!stream ? <div className="empty-preview">{label}</div> : null}
    </div>
  );
}

function CameraPanel({
  mode,
  title,
  description,
  stream,
  selectedDevice,
  resolutionAttempt,
  isStreaming,
  onStartRear,
  onPlaySelected,
  onStop,
}: {
  mode: WorkbenchMode;
  title: string;
  description: string;
  stream: MediaStream | null;
  selectedDevice: CameraDeviceInfo | null;
  resolutionAttempt?: string | null;
  isStreaming: boolean;
  onStartRear: () => Promise<void>;
  onPlaySelected: (device: RawMediaDevice) => Promise<void>;
  onStop: () => void;
}) {
  const [status, patchStatus] = usePanelStatus();
  const videoDevices = useMemo(() => getVideoInputDevices(status.mediaDevices), [status.mediaDevices]);
  const selectedRawDevice = videoDevices.find((device) => device.deviceId === status.selectedDeviceId) ?? null;
  const snapshot = useMemo(() => getStreamSnapshot(stream), [stream]);
  const executionInfo = useMemo(
    () => ({
      selectedDevice,
      resolutionAttempt,
      stream: getStreamSummary(snapshot),
    }),
    [resolutionAttempt, selectedDevice, snapshot],
  );
  const executionSettings = useMemo(() => getStreamSettings(snapshot), [snapshot]);
  const executionCapabilities = useMemo(() => getStreamCapabilities(snapshot), [snapshot]);

  const runAction = async (action: CameraAction, task: () => Promise<void>, owner?: StreamOwner) => {
    patchStatus({ action, error: null });

    try {
      await task();
      patchStatus({ owner: owner ?? status.owner });
    } catch (error) {
      patchStatus({ error: mode === "to-be" ? toErrorMessage(mapBrowserErrorToIdcardCameraError(error)) : toErrorMessage(error) });
    } finally {
      patchStatus({ action: null });
    }
  };

  const handlePermission = () => {
    void runAction("permission", async () => {
      patchStatus({ permission: await requestCameraPermission() });
    });
  };

  const handleLoadDevices = () => {
    void runAction("devices", async () => {
      const devices = await loadAllMediaDevices();
      const nextVideoDevices = getVideoInputDevices(devices);
      patchStatus({
        mediaDevices: devices,
        selectedDeviceId: status.selectedDeviceId || nextVideoDevices[0]?.deviceId || "",
      });
    });
  };

  const handleStartRear = () => {
    patchStatus({ requestInfo: createRearRequestInfo(mode) });
    void runAction("rear", onStartRear, "rear");
  };

  const handlePlaySelected = () => {
    if (!selectedRawDevice) return;
    patchStatus({ requestInfo: createSelectedDeviceRequestInfo(mode, selectedRawDevice) });
    void runAction("selected", () => onPlaySelected(selectedRawDevice), "selected");
  };

  const handleStop = () => {
    onStop();
    patchStatus({ owner: null, error: null });
  };

  return (
    <section className="camera-panel" data-mode={mode}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{mode}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <StatusStrip permission={status.permission} stream={stream} owner={status.owner} selectedDevice={selectedDevice} resolutionAttempt={resolutionAttempt} />

      {status.error ? (
        <div className="error-panel" role="alert">
          {status.error}
        </div>
      ) : null}

      <div className="control-grid">
        <button type="button" onClick={handlePermission} disabled={status.action !== null}>
          {status.action === "permission" ? "권한 확인 중" : "카메라 권한"}
        </button>
        <button type="button" onClick={handleStartRear} disabled={status.action !== null}>
          {status.action === "rear" ? "후면 실행 중" : "후면 카메라 실행"}
        </button>
        <button type="button" onClick={handleLoadDevices} disabled={status.action !== null}>
          {status.action === "devices" ? "조회 중" : "카메라 목록 조회"}
        </button>
        <DeviceSelect
          devices={status.mediaDevices}
          selectedDeviceId={status.selectedDeviceId}
          disabled={status.action !== null}
          onChange={(deviceId) => patchStatus({ selectedDeviceId: deviceId })}
        />
        <button type="button" onClick={handlePlaySelected} disabled={status.action !== null || !selectedRawDevice}>
          {status.action === "selected" ? "선택 실행 중" : "선택 장치 재생"}
        </button>
        <button type="button" className="secondary" onClick={handleStop} disabled={!isStreaming && !stream}>
          정지
        </button>
      </div>

      <div className="panel-body">
        <StreamPreview stream={stream} label={`${title} preview`} />

        <div className="info-stack">
          <section className="data-section">
            <div className="section-title">
              <h3>미디어 정보</h3>
              <span>{videoDevices.length}</span>
            </div>
            <MediaDeviceList devices={status.mediaDevices} selectedDeviceId={status.selectedDeviceId} />
          </section>

          <section className="data-section">
            <div className="section-title">
              <h3>요청 정보</h3>
            </div>
            <pre>{formatJson(status.requestInfo ?? {})}</pre>
          </section>

          <section className="data-section">
            <div className="section-title">
              <h3>실행 정보</h3>
              <span>{snapshot.tracks.length} tracks</span>
            </div>
            <pre>{formatJson(executionInfo)}</pre>
          </section>

          <section className="debug-grid">
            <div className="data-section">
              <div className="section-title">
                <h3>settings</h3>
              </div>
              <pre>{formatJson(executionSettings)}</pre>
            </div>

            <div className="data-section">
              <div className="section-title">
                <h3>capabilities</h3>
              </div>
              <pre>{formatJson(executionCapabilities)}</pre>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function AsIsPanel() {
  const camera = useCameraStream();

  const selectedDevice = camera.currentDevice;

  const startRear = useCallback(async () => {
    await camera.startStream(IDCARD_CAMERA_OPTIONS);
  }, [camera]);

  const playSelected = useCallback(
    async (device: RawMediaDevice) => {
      await camera.startStream(toAsIsDeviceOptions(device));
    },
    [camera],
  );

  return (
    <CameraPanel
      mode="as-is"
      title="AS-IS"
      description="기존 useCameraStream 흐름으로 후면 카메라 선별, 해상도 fallback, 임의 장치 재생을 확인합니다."
      stream={camera.stream}
      selectedDevice={selectedDevice}
      isStreaming={camera.isStreaming}
      onStartRear={startRear}
      onPlaySelected={playSelected}
      onStop={camera.stopStream}
    />
  );
}

function ToBePanel() {
  const camera = useToBeWorkbench();

  return (
    <CameraPanel
      mode="to-be"
      title="TO-BE"
      description="MediaDevices gateway, IdcardCameraPolicy, PrepareIdcardCameraStream 조합으로 같은 유스케이스를 확인합니다."
      stream={camera.stream}
      selectedDevice={camera.selectedDevice}
      resolutionAttempt={camera.resolutionAttempt}
      isStreaming={camera.isStreaming}
      onStartRear={camera.prepareRearStream}
      onPlaySelected={camera.playSelectedDevice}
      onStop={camera.stopStream}
    />
  );
}

function App() {
  const [activeMode, setActiveMode] = useState<WorkbenchMode>("as-is");
  const runtimeCapabilities = useMemo(() => getRuntimeCapabilities(), []);

  return (
    <main className="camera-workbench">
      <header className="camera-header">
        <div>
          <p className="eyebrow">Camera refactor verification</p>
          <h1>카메라 테스트</h1>
        </div>
      </header>

      <div className="mode-toolbar">
        <div className="runtime-status" aria-label="Browser media runtime status">
          <span>isSecureContext: {String(runtimeCapabilities.isSecureContext)}</span>
          <span>getUserMedia: {String(runtimeCapabilities.getUserMedia)}</span>
        </div>
        <label className="field mode-select">
          <span>테스트 방식</span>
          <select value={activeMode} onChange={(event) => setActiveMode(event.target.value as WorkbenchMode)}>
            <option value="as-is">AS-IS</option>
            <option value="to-be">TO-BE</option>
          </select>
        </label>
      </div>

      <div className="comparison-grid">
        {activeMode === "as-is" ? <AsIsPanel /> : <ToBePanel />}
      </div>
    </main>
  );
}

export default App;
