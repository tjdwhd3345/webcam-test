import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CameraPolicyDecisionView,
  CameraPreparationDetailsView,
  CameraValidationView,
  RawMediaDevice,
  WorkbenchMode,
} from "./camera_test_types";
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
  isLoading?: boolean;
  hookError?: unknown;
  automaticRequestInfo?: Record<string, unknown>;
  getManualRequestInfo?: (device: RawMediaDevice) => Record<string, unknown>;
  requireEnvironmentCamera?: boolean;
  policyDecisions?: CameraPolicyDecisionView[];
  preparationDetails?: CameraPreparationDetailsView | null;
  manualValidation?: CameraValidationView | null;
  manualActionLabel?: string;
  onRequestPermission: () => Promise<PermissionState | "unknown">;
  onEnumerateDevices: () => Promise<RawMediaDevice[]>;
  onStartAutomatic: () => Promise<void>;
  onStartManualDevice: (device: RawMediaDevice) => Promise<void>;
  onStop: () => void;
  onRequireEnvironmentCameraChange?: (checked: boolean) => void;
  onVideoPlayFailure?: (error: unknown, stream: MediaStream) => string | null;
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

function useVideoElement(stream: MediaStream | null, onVideoPlayFailure?: (error: unknown, stream: MediaStream) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = stream;
    if (!stream || !onVideoPlayFailure) return;

    void video.play().catch((error: unknown) => {
      onVideoPlayFailure(error, stream);
    });
  }, [onVideoPlayFailure, stream]);

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
  isLoading,
}: {
  permission: PermissionState | "unknown";
  stream: MediaStream | null;
  owner: StreamOwner;
  selectedDevice: SelectedCameraDevice | null;
  resolutionAttempt?: string | null;
  isLoading: boolean;
}) {
  const settings = stream?.getVideoTracks()[0]?.getSettings?.();
  const resolution = settings?.width && settings.height ? `${settings.width}x${settings.height}` : "-";

  return (
    <div className="status-grid" aria-live="polite">
      <span>권한: {permission}</span>
      <span>스트림: {isLoading ? "loading" : stream ? "playing" : "stopped"}</span>
      <span>실행: {stream ? owner ?? "rear" : "-"}</span>
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
  onVideoPlayFailure,
}: {
  stream: MediaStream | null;
  label: string;
  onVideoPlayFailure?: (error: unknown, stream: MediaStream) => void;
}) {
  const videoRef = useVideoElement(stream, onVideoPlayFailure);

  return (
    <div className="preview-panel">
      <video ref={videoRef} playsInline muted autoPlay />
      {!stream ? <div className="empty-preview">{label}</div> : null}
    </div>
  );
}

function PolicyDecisionTable({ decisions }: { decisions: CameraPolicyDecisionView[] }) {
  if (decisions.length === 0) return null;

  return (
    <section className="data-section">
      <div className="section-title">
        <h3>정책 결정</h3>
        <span>{decisions.length}</span>
      </div>
      <div className="decision-table-wrap">
        <table className="decision-table" aria-label="카메라 정책 결정">
          <thead>
            <tr>
              <th>장치</th>
              <th>방향</th>
              <th>판정</th>
              <th>이유</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((decision) => (
              <tr key={decision.device.deviceId || decision.device.label}>
                <td>{decision.device.label}</td>
                <td>{decision.facingAssessment}</td>
                <td>
                  <span className={`validation-badge ${decision.passed ? "pass" : "fail"}`}>{decision.passed ? "PASS" : "FAIL"}</span>
                </td>
                <td>{decision.reasons.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ValidationResult({ title, validation }: { title: string; validation: CameraValidationView }) {
  return (
    <section className="validation-result" aria-label={title}>
      <div>
        <strong>{title}</strong>
        <span className={`validation-badge ${validation.valid ? "pass" : "fail"}`}>{validation.valid ? "valid" : "invalid"}</span>
      </div>
      <pre>{formatJson(validation.settings)}</pre>
    </section>
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
  isLoading = false,
  hookError,
  automaticRequestInfo,
  getManualRequestInfo = createDefaultManualRequestInfo,
  requireEnvironmentCamera,
  policyDecisions = [],
  preparationDetails,
  manualValidation,
  manualActionLabel = "선택 장치 재생",
  onRequestPermission,
  onEnumerateDevices,
  onStartAutomatic,
  onStartManualDevice,
  onStop,
  onRequireEnvironmentCameraChange,
  onVideoPlayFailure,
}: CameraPanelProps) {
  const actionIdRef = useRef(0);
  useEffect(() => () => { actionIdRef.current += 1; }, []);
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

  const runAction = async (action: CameraAction, task: (isCurrent: () => boolean) => Promise<void>, owner?: StreamOwner) => {
    const actionId = actionIdRef.current + 1;
    actionIdRef.current = actionId;
    patchStatus({ action, error: null, owner: null });

    try {
      await task(() => actionId === actionIdRef.current);
      if (owner && actionId === actionIdRef.current) patchStatus({ owner });
    } catch (error) {
      if (actionId === actionIdRef.current) patchStatus({ error: toErrorMessage(error) });
    } finally {
      if (actionId === actionIdRef.current) patchStatus({ action: null });
    }
  };

  const handlePermission = () => {
    void runAction("permission", async (isCurrent) => {
      const permission = await onRequestPermission();
      if (isCurrent()) patchStatus({ permission });
    });
  };

  const handleLoadDevices = () => {
    void runAction("devices", async (isCurrent) => {
      const devices = await onEnumerateDevices();
      if (!isCurrent()) return;
      const nextVideoDevices = getVideoInputDevices(devices);
      patchStatus({
        mediaDevices: devices,
        selectedDeviceId: status.selectedDeviceId || nextVideoDevices[0]?.deviceId || "",
      });
    });
  };

  const handleStartAutomatic = () => {
    patchStatus({ owner: null, requestInfo: automaticRequestInfo ?? { mode, action: "rear-camera" } });
    void runAction("rear", onStartAutomatic, "rear");
  };

  const handlePlaySelected = () => {
    if (!selectedRawDevice) return;
    patchStatus({ owner: null, requestInfo: getManualRequestInfo(selectedRawDevice) });
    void runAction("selected", () => onStartManualDevice(selectedRawDevice), "selected");
  };

  const handleStop = () => {
    actionIdRef.current += 1;
    onStop();
    patchStatus({ action: null, owner: null, error: null });
  };

  const handleVideoPlayFailure = useCallback(
    (error: unknown, failedStream: MediaStream) => {
      const message = onVideoPlayFailure?.(error, failedStream);
      if (message) patchStatus({ error: message });
    },
    [onVideoPlayFailure, patchStatus],
  );
  const busy = status.action !== null || isLoading;
  const errorMessage = status.error ?? (hookError ? toErrorMessage(hookError) : null);

  return (
    <section className="camera-panel" data-mode={mode}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{mode}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <StatusStrip permission={status.permission} stream={stream} owner={status.owner} selectedDevice={selectedDevice} resolutionAttempt={resolutionAttempt} isLoading={isLoading} />

      {errorMessage ? (
        <div className="error-panel" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {onRequireEnvironmentCameraChange ? (
        <label className="strict-mode-control">
          <input
            type="checkbox"
            aria-label="모바일 후면 카메라 강제"
            checked={requireEnvironmentCamera === true}
            disabled={busy}
            onChange={(event) => onRequireEnvironmentCameraChange(event.target.checked)}
          />
          <span>
            <strong>모바일 후면 카메라 강제</strong>
            <small>확인된 전면은 제외합니다. 후면은 exact, 방향 미상 호환 후보는 ideal 제약으로 시도합니다.</small>
          </span>
        </label>
      ) : null}

      <div className="control-grid">
        <button type="button" onClick={handlePermission} disabled={busy}>
          {status.action === "permission" ? "권한 확인 중" : "카메라 권한"}
        </button>
        <button type="button" onClick={handleStartAutomatic} disabled={busy}>
          {status.action === "rear" ? "후면 실행 중" : "후면 카메라 실행"}
        </button>
        <button type="button" onClick={handleLoadDevices} disabled={busy}>
          {status.action === "devices" ? "조회 중" : "카메라 목록 조회"}
        </button>
        <DeviceSelect
          devices={status.mediaDevices}
          selectedDeviceId={status.selectedDeviceId}
          disabled={busy}
          onChange={(deviceId) => patchStatus({ selectedDeviceId: deviceId })}
        />
        <button type="button" onClick={handlePlaySelected} disabled={busy || !selectedRawDevice}>
          {status.action === "selected" ? "선택 실행 중" : manualActionLabel}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleStop}
          disabled={!busy && !isStreaming && !stream}
        >
          정지
        </button>
      </div>

      <div className="panel-body">
        <StreamPreview stream={stream} label={`${title} preview`} onVideoPlayFailure={onVideoPlayFailure ? handleVideoPlayFailure : undefined} />

        <div className="info-stack">
          <section className="data-section">
            <div className="section-title">
              <h3>미디어 정보</h3>
              <span>{videoDevices.length}</span>
            </div>
            <MediaDeviceList devices={status.mediaDevices} selectedDeviceId={status.selectedDeviceId} />
          </section>

          <PolicyDecisionTable decisions={policyDecisions} />

          {preparationDetails ? (
            <section className="preparation-result" aria-label="준비 결과">
              <div className="section-title">
                <h3>production 준비 결과</h3>
                <span className={`validation-badge ${preparationDetails.validation.valid ? "pass" : "fail"}`}>
                  {preparationDetails.validation.valid ? "PASS" : "FAIL"}
                </span>
              </div>
              <dl>
                <div>
                  <dt>선택</dt>
                  <dd>선택 사유: {preparationDetails.selectionReason}</dd>
                </div>
                <div>
                  <dt>방향</dt>
                  <dd>방향 판정: {preparationDetails.facingAssessment}</dd>
                </div>
                <div>
                  <dt>해상도</dt>
                  <dd>해상도 시도: {preparationDetails.resolutionAttempt}</dd>
                </div>
                <div>
                  <dt>검증</dt>
                  <dd>스트림 검증: {preparationDetails.validation.valid ? "valid" : "invalid"}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {manualValidation ? <ValidationResult title="직접 재생 검증" validation={manualValidation} /> : null}

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
