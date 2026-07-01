import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Room from "./pages/Room.jsx";
import Brand from "./components/Brand.jsx";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand />
        </div>
      </header>
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer>
        <div className="wrap footer-inner">
          <span>Watch Together · salle de projection virtuelle</span>
          <span>React · Socket.IO</span>
        </div>
      </footer>
    </div>
  );
}
