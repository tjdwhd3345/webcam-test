import { getInputDevices } from "./src/permission.js";

const requestPermissionButton = document.querySelector("#requestPermission");
const playCameraButton = document.querySelector("#playCamera");
const stopCameraButton = document.querySelector("#stopCamera");


const video = document.querySelector("#video");

const cameraList = document.querySelector("#cameraList");

let stream;
let camera;

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
  if (!value && selectedIndex === 0) return;

  const selectedCamera = camera[selectedIndex - 1];

  const constraintWidth = { ideal: 1920, min: 1280 };
  const constraintHeight = { ideal: 1080, min: 720 };

  const facingMode = selectedCamera.capa.facingMode ? selectedCamera.capa.facingMode[0] : "environment";

  const constraints = {
    audio: false,
    video: {
      zoom: { ideal: 1 },
      facingMode: { ideal: facingMode },
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
    camera = await getInputDevices();

    constraints.video.deviceId = camera.length ? { ideal: camera[camera.length - 1].device.deviceId } : null;
  }

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  console.log(`constraints : `, { constraints });
  const streamSettings = stream.getVideoTracks()[0].getSettings();
  console.log(`streamSettings : `, { streamSettings });

  setVideoLabel(`Now Playing: ${selectedCamera.device.label}`);
}

const addEventListener = (element, eventname, handler) => {
  if (!element) throw new Error("element doesn't exist !!");
  element.addEventListener(eventname, handler);
};

const handleRequestPermission = async (e) => {
  camera = await getInputDevices();
  setCameraList(camera);
};

const handleVideoLoadedMetadata = () => {
  console.log("loadedmetadata");
};
const handleVideoCanplay = async () => {
  console.log("canplay");
};
const handleVideoEnded = async () => {
  console.log("ended");
};

const handlePlayCamera = async (e) => {
  if (isPlaying()) stopStream();
  await requestCameraPlay();

  if (stream) {
    video.srcObject = stream;
  }
};

const handleStopCamera = async (e) => {
  stopStream();
};

const handleCameraChange = (e) => {
  const constraints = JSON.stringify(camera[cameraList.selectedIndex - 1], null, 2);
  document.querySelector(".constraint-container pre").innerHTML = cameraList.selectedIndex === 0 ? "" : constraints;
};

function init() {
  addEventListener(requestPermissionButton, "click", handleRequestPermission);
  addEventListener(video, "loadedmetadata", handleVideoLoadedMetadata);
  addEventListener(video, "canplay", handleVideoCanplay);
  addEventListener(video, "ended", handleVideoEnded);
  addEventListener(playCameraButton, "click", handlePlayCamera);
  addEventListener(stopCameraButton, "click", handleStopCamera);
  addEventListener(cameraList, "change", handleCameraChange);
}

init();
