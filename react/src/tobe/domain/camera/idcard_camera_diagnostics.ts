import type { CameraDeviceInfo } from "@tobe/lib/auth/types/camera";

export type IdcardCameraDiagnosticChannel = "getUserMedia" | "devices" | "selection" | "candidates";

export interface IdcardCameraDiagnosticEvent {
  channel: IdcardCameraDiagnosticChannel;
  payload: Record<string, unknown>;
}

export type IdcardCameraDiagnosticLogger = (channel: IdcardCameraDiagnosticChannel, payload: Record<string, unknown>) => void;

type NumericRangeSummary = { min?: number; max?: number } | null;

const summarizeRange = (range: { min?: number; max?: number } | undefined): NumericRangeSummary => {
  if (!range) return null;

  const summary = {
    ...(typeof range.min === "number" ? { min: range.min } : {}),
    ...(typeof range.max === "number" ? { max: range.max } : {}),
  };

  return Object.keys(summary).length > 0 ? summary : null;
};

const summarizeFacingMode = (facingMode: string | undefined) => {
  if (facingMode === "environment") return { facingMode, environment: true as const };
  if (facingMode === "user") return { facingMode, environment: false as const };

  return { facingMode: facingMode ?? ("unknown" as const), environment: null };
};

export const maskCameraDeviceId = (deviceId: string | undefined): string | null => {
  if (!deviceId) return null;

  let hash = 0x811c9dc5;
  for (let index = 0; index < deviceId.length; index += 1) {
    hash ^= deviceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `device-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const summarizeCameraCapabilities = (capabilities: MediaTrackCapabilities | undefined) => ({
  width: summarizeRange(capabilities?.width),
  height: summarizeRange(capabilities?.height),
  zoom: summarizeRange((capabilities as (MediaTrackCapabilities & { zoom?: { min?: number; max?: number } }) | undefined)?.zoom),
});

export const summarizeCameraDevice = (device: CameraDeviceInfo, index?: number) => ({
  ...(index === undefined ? {} : { index }),
  deviceId: maskCameraDeviceId(device.deviceId),
  label: device.label,
  ...summarizeFacingMode(device.facingMode),
  ...summarizeCameraCapabilities(device.capabilities),
});

export const summarizeCameraSettings = (settings: MediaTrackSettings) => ({
  deviceId: maskCameraDeviceId(settings.deviceId),
  ...summarizeFacingMode(settings.facingMode),
  width: typeof settings.width === "number" ? settings.width : null,
  height: typeof settings.height === "number" ? settings.height : null,
});

const maskDeviceIdConstraint = (constraint: unknown): unknown => {
  if (typeof constraint === "string") return maskCameraDeviceId(constraint);
  if (Array.isArray(constraint)) return constraint.map(maskDeviceIdConstraint);
  if (!constraint || typeof constraint !== "object") return constraint;

  return Object.fromEntries(Object.entries(constraint).map(([key, value]) => [key, maskDeviceIdConstraint(value)]));
};

export const summarizeMediaStreamConstraints = (constraints: MediaStreamConstraints): Record<string, unknown> => {
  const video = constraints.video;
  if (!video || typeof video === "boolean") return { video, audio: constraints.audio };

  return {
    video: {
      ...video,
      ...(video.deviceId === undefined ? {} : { deviceId: maskDeviceIdConstraint(video.deviceId) }),
    },
    audio: constraints.audio,
  };
};

export const summarizeCameraError = (error: unknown): { name: string; constraint?: string } => {
  const candidate = error as { name?: unknown; constraint?: unknown; constraintName?: unknown } | undefined;
  const name = typeof candidate?.name === "string" ? candidate.name : "UnknownError";
  const constraint = candidate?.constraint ?? candidate?.constraintName;

  return {
    name,
    ...(typeof constraint === "string" ? { constraint } : {}),
  };
};
