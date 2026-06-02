// const requestPermissionButton = document.querySelector("#requestPermission");

export async function getInputDevices() {
  // throw error if navigator.mediaDevices is not supported
  if (!navigator.mediaDevices) {
    throw new Error("navigator.mediaDevices is not supported");
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  let camera = [];
  for (const device of devices) {
    if (device.kind === "videoinput") {
      try {
        if (device instanceof InputDeviceInfo) {
          if (device.getCapabilities) {
            const capa = device.getCapabilities();
            if (capa?.facingMode?.includes("environment")) {
              const isUltraCameraReg = /ultra|울트라/gi;
              if (isUltraCameraReg.test(device.label?.toLowerCase())) continue;
              camera.push({ device, capa });
            } else {
              camera.push({ device, capa });
            }
          }
        }
      } catch (e) {
        // iOS 17 미만의 chrome, safari 에서는
        // InputDeviceInfo 객체가 없어서 getCapabilities를 확인할 수 없기 때문에
        // device label만 보고 후면 카메라로 사용
        if (e instanceof ReferenceError) {
          // const isBackCameraReg = /back|후면/g;
          // if (device.label?.length && isBackCameraReg.test(device.label)) {
          //   camera.push({ device });
          // }
          camera.push({ device });
        }
      }
    }
  }
  console.log(`camera.length = ${camera.length}`, { camera });
  return camera;
}
