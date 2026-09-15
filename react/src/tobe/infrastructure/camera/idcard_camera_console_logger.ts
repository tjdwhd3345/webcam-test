import type { IdcardCameraDiagnosticLogger } from "@tobe/domain/camera/idcard_camera_diagnostics";

export const idcardCameraConsoleLogger: IdcardCameraDiagnosticLogger = (channel, payload) => {
  if (process.env.NODE_ENV === "test") return;

  // Production builds remove direct console.log calls, so access it through globalThis.
  globalThis.console.log(`[IdcardCamera][${channel}]`, payload);
};
