// src/tui/index.tsx
import React from "react";
import { render } from "ink";
import { App } from "./app";
import { prepareRuntime } from "../migration";

export function runTui() {
  prepareRuntime();
  render(<App />);
}

if (import.meta.main) {
  runTui();
}
