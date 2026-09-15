import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RawMediaDevice, WorkbenchMode } from "./camera_test_types";
import { getStreamSnapshot, getVideoInputDevices, toErrorMessage } from "./camera_test_utils";

type CameraAction = "permission" | "rear" | "devices" | "selected" | null;
type StreamOwner = "rear" | "selected" | null;

type SelectedCameraDevice = {
  deviceId: string;
  label: string;
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

export interface CameraPanelProps {
  mode: WorkbenchMode;
  title: string;
  description: string;
  stream: MediaStream | null;
  selectedDevice: SelectedCameraDevice | null;
  resolutionAttempt?: string | null;
  isStreaming: boolean;
  automaticRequestInfo?: Record<string, unknown>;
  getManualRequestInfo?: (device: RawMediaDevice) => Record<string, unknown>;
  onRequestPermission: () => Promise<PermissionState | "unknown">;
  onEnumerateDevices: () => Promise<RawMediaDevice[]>;
  onStartAutomatic: () => Promise<void>;
  onStartManualDevice: (device: RawMediaDevice) => Promise<void>;
  onStop: () => void;
}

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2);

const formatDeviceResolution = (device: RawMediaDevice): string => {
  const width = device.capabilities?.width;
  const height = device.capabilities?.height;

  if (typeof width?.max === "number" && typeof height?.max === "number") {
    return `max ${width.max} x ${height.max}`;
  }

  return "-";
};

const createDefaultManualRequestInfo = (device: RawMediaDevice): Record<string, unknown> => ({
  action: "selected-device",
  selectedDevice: {
    deviceId: device.deviceId,
    label: device.label,
    resolution: formatDeviceResolution(device),
  },
});

function useVideoElement(stream: MediaStream | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return videoRef;
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
  selectedDevice: SelectedCameraDevice | null;
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

function StreamPreview({ stream, label }: { stream: MediaStream | null; label: string }) {
  const videoRef = useVideoElement(stream);

  return (
    <div className="preview-panel">
      <video ref={videoRef} playsInline muted autoPlay />
      {!stream ? <div className="empty-preview">{label}</div> : null}
    </div>
  );
}

export function CameraPanel({
  mode,
  title,
  description,
  stream,
  selectedDevice,
  resolutionAttempt,
  isStreaming,
  automaticRequestInfo,
  getManualRequestInfo = createDefaultManualRequestInfo,
  onRequestPermission,
  onEnumerateDevices,
  onStartAutomatic,
  onStartManualDevice,
  onStop,
}: CameraPanelProps) {
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
  const videoDevices = useMemo(() => getVideoInputDevices(status.mediaDevices), [status.mediaDevices]);
  const selectedRawDevice = videoDevices.find((device) => device.deviceId === status.selectedDeviceId) ?? null;
  const snapshot = useMemo(() => getStreamSnapshot(stream), [stream]);
  const executionInfo = useMemo(
    () => ({
      selectedDevice,
      resolutionAttempt,
      stream: {
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
      },
    }),
    [resolutionAttempt, selectedDevice, snapshot],
  );
  const executionSettings = useMemo(
    () => snapshot.tracks.map((track) => ({ id: track.id, label: track.label, settings: track.settings })),
    [snapshot],
  );
  const executionCapabilities = useMemo(
    () => snapshot.tracks.map((track) => ({ id: track.id, label: track.label, capabilities: track.capabilities ?? null })),
    [snapshot],
  );

  const runAction = async (action: CameraAction, task: () => Promise<void>, owner?: StreamOwner) => {
    patchStatus({ action, error: null });

    try {
      await task();
      if (owner) patchStatus({ owner });
    } catch (error) {
      patchStatus({ error: toErrorMessage(error) });
    } finally {
      patchStatus({ action: null });
    }
  };

  const handlePermission = () => {
    void runAction("permission", async () => {
      patchStatus({ permission: await onRequestPermission() });
    });
  };

  const handleLoadDevices = () => {
    void runAction("devices", async () => {
      const devices = await onEnumerateDevices();
      const nextVideoDevices = getVideoInputDevices(devices);
      patchStatus({
        mediaDevices: devices,
        selectedDeviceId: status.selectedDeviceId || nextVideoDevices[0]?.deviceId || "",
      });
    });
  };

  const handleStartAutomatic = () => {
    patchStatus({ requestInfo: automaticRequestInfo ?? { mode, action: "rear-camera" } });
    void runAction("rear", onStartAutomatic, "rear");
  };

  const handlePlaySelected = () => {
    if (!selectedRawDevice) return;
    patchStatus({ requestInfo: getManualRequestInfo(selectedRawDevice) });
    void runAction("selected", () => onStartManualDevice(selectedRawDevice), "selected");
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
        <button type="button" onClick={handleStartAutomatic} disabled={status.action !== null}>
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
