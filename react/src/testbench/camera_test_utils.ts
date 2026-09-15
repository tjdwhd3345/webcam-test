import type { RawMediaDevice, StreamSnapshot } from "./camera_test_types";

const emptySnapshot: StreamSnapshot = {
  active: false,
  tracks: [],
};

export const getMediaDevices = (): MediaDevices => {
  if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("MediaDevices API is not supported.");
  }

  return navigator.mediaDevices;
};

export const stopMediaStream = (stream: MediaStream | null | undefined): void => {
  stream?.getTracks().forEach((track) => track.stop());
};

const resolveFacingMode = (label: string, facingModes?: string[]): RawMediaDevice["facingMode"] => {
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

export const requestCameraPermission = async (): Promise<PermissionState | "unknown"> => {
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

export const loadAllMediaDevices = async (): Promise<RawMediaDevice[]> => {
  const devices = await getMediaDevices().enumerateDevices();
  return devices.map(toRawMediaDevice);
};

export const getVideoInputDevices = (devices: RawMediaDevice[]): RawMediaDevice[] => devices.filter((device) => device.kind === "videoinput");

export const getRuntimeCapabilities = (): { isSecureContext: boolean; getUserMedia: boolean } => ({
  isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
  getUserMedia: typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function",
});

export const getStreamSnapshot = (stream: MediaStream | null): StreamSnapshot => {
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

export const toErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return `${String((error as { code: unknown }).code)}: ${String((error as { message: unknown }).message)}`;
  }
  if (error && typeof error === "object" && "type" in error && "message" in error) {
    return `${String((error as { type: unknown }).type)}: ${String((error as { message: unknown }).message)}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown camera error";
};

export const toExactDeviceConstraints = (device: RawMediaDevice): MediaStreamConstraints => ({
  video: {
    deviceId: { exact: device.deviceId },
    ...(device.facingMode ? { facingMode: { ideal: device.facingMode } } : {}),
  },
  audio: false,
});
