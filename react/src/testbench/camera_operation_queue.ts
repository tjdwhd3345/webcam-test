// A stopped getUserMedia request cannot be cancelled. Keep explicit testbench
// actions ordered across panel unmounts until each pending action has cleaned up.
// Internal hook initialization/recovery remains owned by the copied hooks.
let pendingOperation: Promise<unknown> = Promise.resolve();

export function runCameraOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingOperation.then(operation);
  pendingOperation = result.catch(() => undefined);
  return result;
}
