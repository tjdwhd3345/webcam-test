const requestPermissionButton = document.querySelector("#requestPermission");
const playCameraButton = document.querySelector("#playCamera");
const stopCameraButton = document.querySelector("#stopCamera");

const video = document.querySelector("#video");

const cameraList = document.querySelector("#cameraList");

let stream;
let camera;

async function __getInputDevices() {
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
          const isBackCameraReg = /back|후면/g;
          if (device.label?.length && isBackCameraReg.test(device.label)) {
            camera.push({ device });
          }
        }
      }
    }
  }
  console.log(`camera.length = ${camera.length}`, { camera });
  return camera;
}

function setCameraList(camera) {
  const sel = document.querySelector("#cameraList");
  sel.innerHTML = `<option value="">-</option>`; // 초기화

  const cameraListHTMLText = camera.map(({ device }) => `<option value="${device.deviceId}">${device.label}</option>`);
  sel.insertAdjacentHTML("beforeend", cameraListHTMLText.join(""));
}

function setVideoLabel(label) {
  document.querySelector("#videoLabel").textContent = label;
}

function isPlaying() {
  return !!(video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2);
}

async function stopStream() {
  setVideoLabel(``);
  if (stream) {
    stream.stop && stream.stop();
    let tracks = stream.getTracks && stream.getTracks();
    console.log("stopStream", tracks);
    if (tracks && tracks.length) {
      tracks.forEach((track) => track.stop());
    }
    // stream = null;
  }
}

async function requestCameraPlay() {
  const { selectedIndex, value } = cameraList;
  if (!value) return;

  const constraintWidth = { ideal: 1920, min: 1280 };
  const constraintHeight = { ideal: 1080, min: 720 };

  const constraints = {
    audio: false,
    video: {
      zoom: { ideal: 1 },
      // facingMode: { ideal: this.__facingModeConstraint },
      facingMode: { ideal: camera[selectedIndex].capa.facingMode[0] },
      focusMode: { ideal: "continuous" },
      whiteBalanceMode: { ideal: "continuous" },
      deviceId: value,
      width: constraintWidth,
      height: constraintHeight,
    },
  };

  if (camera.length === 0) {
    console.log("cannot to get camera devices. so, try to get camera devices again");
    console.log(`constraints : ${JSON.stringify(constraints)}`);
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    stopStream();
    camera = await __getInputDevices();

    constraints.video.deviceId = camera.length ? { ideal: camera[camera.length - 1].device.deviceId } : null;
  }

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  console.log(`constraints : `, { constraints });
  const streamSettings = stream.getVideoTracks()[0].getSettings();
  console.log(`streamSettings : `, { streamSettings });

  setVideoLabel(`Now Playing: ${camera[selectedIndex].device.label}`);
}

requestPermissionButton.addEventListener("click", async (e) => {
  camera = await __getInputDevices();
  setCameraList(camera);
});

video.addEventListener("loadedmetadata", () => {
  console.log("loadedmetadata");
});
video.addEventListener("canplay", async () => {
  console.log("canplay");
});

playCameraButton.addEventListener("click", async (e) => {
  if (isPlaying()) stopStream();
  await requestCameraPlay();

  if (stream) {
    video.srcObject = stream;
  }
});

stopCameraButton.addEventListener("click", (e) => {
  stopStream();
});

cameraList.addEventListener("change", (e) => {
  const constraints = JSON.stringify(camera[cameraList.selectedIndex - 1], null, 2);
  document.querySelector(".constraint-container pre").innerHTML = cameraList.selectedIndex === 0 ? "" : constraints;
});
