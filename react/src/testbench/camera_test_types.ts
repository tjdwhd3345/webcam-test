export type WorkbenchMode = "as-is" | "to-be";

export interface RawMediaDevice {
  deviceId: string;
  groupId: string;
  kind: MediaDeviceKind;
  label: string;
  facingMode?: "user" | "environment";
  capabilities?: MediaTrackCapabilities;
}

export interface StreamSnapshot {
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
}

export interface CameraPolicyDecisionView {
  device: RawMediaDevice;
  facingAssessment: "environment" | "user" | "unknown";
  passed: boolean;
  reasons: string[];
}

export interface CameraValidationView {
  valid: boolean;
  settings: MediaTrackSettings;
}

export interface CameraPreparationDetailsView {
  selectionReason: string;
  facingAssessment: "environment" | "user" | "unknown";
  resolutionAttempt: string;
  validation: CameraValidationView;
}
