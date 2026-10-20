import ReactDOM from "react-dom/client";
import "../index.css";
import WorkoutPill from "../components/WorkoutPill";
document.documentElement.style.setProperty("--tabbar-h", "64px");
const two = location.hash === "#two";
ReactDOM.createRoot(document.getElementById("root")!).render(<div className="min-h-screen bg-zinc-950">
  {two
    ? <WorkoutPill people={[{ name: "Марина Соколова", color: "#a3e635" }, { name: "Алексей Петров", color: "#22d3ee" }]} title="Марина Соколова и Алексей Петров" sub="0/2 записаны" onOpen={() => {}} />
    : <WorkoutPill people={[{ name: "Марина Соколова", color: "#f472b6" }]} title="Марина Соколова" sub="24:13 · 3/6 упр." rest="1:20" onOpen={() => {}} />}
  <div className="fixed right-4 w-12 h-12 rounded-full bg-lime-400" style={{ bottom: "calc(64px + 12px)" }} />
  <div className="fixed inset-x-0 bottom-0 h-16 bg-zinc-900 border-t border-zinc-800" />
</div>);
