import { useMemo } from "react";
import { AsIsCameraPanel } from "./testbench/AsIsCameraPanel";
import { getRuntimeCapabilities } from "./testbench/camera_test_utils";
import "./App.css";

function App() {
  const runtimeCapabilities = useMemo(() => getRuntimeCapabilities(), []);

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
        </div>
      </div>

      <div className="comparison-grid">
        <AsIsCameraPanel />
      </div>
    </main>
  );
}

export default App;
