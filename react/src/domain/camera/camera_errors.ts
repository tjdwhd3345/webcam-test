export type IdcardCameraErrorCode =
  | "media_devices_not_supported"
  | "camera_permission_denied"
  | "camera_not_found"
  | "camera_not_readable"
  | "camera_resolution_not_supported"
  | "camera_stream_invalid"
  | "camera_stream_stopped"
  | "camera_unknown";

const errorMessages: Record<IdcardCameraErrorCode, string> = {
  media_devices_not_supported: "MediaDevices API is not supported.",
  camera_permission_denied: "Camera permission was denied.",
  camera_not_found: "Camera device was not found.",
  camera_not_readable: "Camera device is not readable.",
  camera_resolution_not_supported: "Requested camera resolution is not supported.",
  camera_stream_invalid: "Camera stream does not satisfy idcard capture requirements.",
  camera_stream_stopped: "Camera stream preparation was stopped.",
  camera_unknown: "Unknown camera error occurred.",
};

export class IdcardCameraError extends Error {
  public readonly code: IdcardCameraErrorCode;
  public readonly originalError?: unknown;

  constructor(code: IdcardCameraErrorCode, message = errorMessages[code], originalError?: unknown) {
    super(message);
    this.name = "IdcardCameraError";
    this.code = code;
    this.originalError = originalError;
  }
}

export const isWidthHeightOverconstrainedError = (error: unknown): boolean => {
  const name = (error as { name?: string } | undefined)?.name;
  const constraint = (error as { constraint?: string } | undefined)?.constraint;

  return name === "OverconstrainedError" && (constraint === "width" || constraint === "height");
};

export const mapBrowserErrorToIdcardCameraError = (error: unknown): IdcardCameraError => {
  if (error instanceof IdcardCameraError) return error;

  const name = (error as { name?: string } | undefined)?.name;

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new IdcardCameraError("camera_permission_denied", undefined, error);
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new IdcardCameraError("camera_not_found", undefined, error);
    case "NotReadableError":
    case "TrackStartError":
      return new IdcardCameraError("camera_not_readable", undefined, error);
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new IdcardCameraError("camera_resolution_not_supported", undefined, error);
    default:
      return new IdcardCameraError("camera_unknown", undefined, error);
  }
};
