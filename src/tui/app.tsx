// src/tui/app.tsx
import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import { Timeline } from "./components/timeline";
import { Search } from "./components/search";
import { Detail } from "./components/detail";
import { StatusBar } from "./components/status";
import { useRecentMemories, useSearchMemories, cleanupDB } from "./hooks/use-memory";
import type { Memory } from "../types";

type View = "timeline" | "search" | "detail";

export function App() {
  const { exit } = useApp();
  const [view, setView] = useState<View>("timeline");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);

  const recentMemories = useRecentMemories();
  const searchResults = useSearchMemories(searchQuery);
  const displayedMemories = view === "search" ? searchResults : recentMemories;

  useInput((input, key) => {
    if (input === "q") {
      cleanupDB();
      exit();
      return;
    }
    if (input === "/" && view !== "search") {
      setView("search");
      return;
    }
    if (key.escape) {
      if (view === "detail") setView("timeline");
      else if (view === "search") { setView("timeline"); setSearchQuery(""); }
      return;
    }
    if (view !== "search") {
      if (key.upArrow) setSelectedIndex(Math.max(0, selectedIndex - 1));
      if (key.downArrow) setSelectedIndex(Math.min(displayedMemories.length - 1, selectedIndex + 1));
      if (key.return && displayedMemories[selectedIndex]) {
        setSelectedMemory(displayedMemories[selectedIndex]);
        setView("detail");
      }
    }
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 24}>
      <StatusBar view={view} memoryCount={recentMemories.length} />
      {view === "timeline" && (
        <Timeline memories={recentMemories} selectedIndex={selectedIndex} />
      )}
      {view === "search" && (
        <Search query={searchQuery} onQueryChange={setSearchQuery} results={searchResults} />
      )}
      {view === "detail" && <Detail memory={selectedMemory} />}
    </Box>
  );
}
