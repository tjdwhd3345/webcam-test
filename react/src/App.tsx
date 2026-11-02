import { useMemo, useState } from "react";
import { AsIsCameraPanel } from "./testbench/AsIsCameraPanel";
import { getRuntimeCapabilities } from "./testbench/camera_test_utils";
import { ToBeCameraPanel } from "./testbench/ToBeCameraPanel";
import type { WorkbenchMode } from "./testbench/camera_test_types";
import "./App.css";

function App() {
  const runtimeCapabilities = useMemo(() => getRuntimeCapabilities(), []);
  const [activeMode, setActiveMode] = useState<WorkbenchMode>("to-be");

  return (
    <main className="camera-workbench">
      <header className="camera-header">
        <div>
          <p className="eyebrow">Camera refactor verification</p>
          <h1>카메라 테스트</h1>
        </div>
      </header>

      <div className="mode-toolbar">
        <div className="runtime-status" aria-label="Browser media runtime status">
          <span>isSecureContext: {String(runtimeCapabilities.isSecureContext)}</span>
          <span>getUserMedia: {String(runtimeCapabilities.getUserMedia)}</span>
          <span>language: {navigator.language}</span>
        </div>
        <label className="field mode-select">
          <span>테스트 방식</span>
          <select value={activeMode} onChange={(event) => setActiveMode(event.target.value as WorkbenchMode)}>
            <option value="as-is">AS-IS</option>
            <option value="to-be">TO-BE</option>
          </select>
        </label>
      </div>

      <div className="comparison-grid">
        {activeMode === "as-is" ? <AsIsCameraPanel key="as-is" /> : <ToBeCameraPanel key="to-be" />}
      </div>
    </main>
  );
}

export default App;
