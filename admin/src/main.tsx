import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/onest";
import "./index.css";
import App from "./App";

if (localStorage.getItem("adm-theme") === "light") document.documentElement.classList.add("light");
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
