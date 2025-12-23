import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "reactflow/dist/style.css";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
