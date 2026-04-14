// src/tui/app.tsx
import React, { useState } from "react";
import { Box, useApp, useInput, Text } from "ink";
import { Timeline } from "./components/timeline";
import { Search } from "./components/search";
import { Detail } from "./components/detail";
import { Header } from "./components/status"; // Renamed component in the file
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
    if (input === "t") {
      setView("timeline");
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
    <Box flexDirection="column" height={process.stdout.rows ?? 24} paddingX={1} paddingY={1}>
      <Header view={view} memoryCount={recentMemories.length} watcherStatus="active" />
      
      <Box flexGrow={1} flexDirection="row">
        {/* Sidebar */}
        <Box flexDirection="column" width={25} marginRight={1}>
          <Box borderStyle="round" borderColor="grey" flexDirection="column" paddingX={1} flexGrow={1}>
            <Box marginTop={-1} paddingX={1}><Text bold color="grey"> 📊 STATS </Text></Box>
            <Box marginTop={1} flexDirection="column">
              <Text bold color="cyan">EPISODIC</Text>
              <Text dimColor>Count: {recentMemories.filter(m => m.layer === "episodic").length}</Text>
              
              <Box marginTop={1}>
                <Text bold color="green">SEMANTIC</Text>
              </Box>
              <Text dimColor>Count: {recentMemories.filter(m => m.layer === "semantic").length}</Text>
              
              <Box marginTop={1}>
                <Text bold color="yellow">PROCEDURAL</Text>
              </Box>
              <Text dimColor>Count: {recentMemories.filter(m => m.layer === "procedural").length}</Text>
              
              <Box marginTop={1}>
                <Text bold color="magenta">INSIGHT</Text>
              </Box>
              <Text dimColor>Count: {recentMemories.filter(m => m.layer === "insight").length}</Text>
            </Box>
          </Box>
        </Box>

        {/* Main Content */}
        <Box flexGrow={1} flexDirection="column">
          {view === "timeline" && (
            <Timeline memories={recentMemories} selectedIndex={selectedIndex} />
          )}
          {view === "search" && (
            <Search query={searchQuery} onQueryChange={setSearchQuery} results={searchResults} />
          )}
          {view === "detail" && <Detail memory={selectedMemory} />}
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1} paddingX={1} borderStyle="single" borderColor="grey" justifyContent="space-between">
        <Box>
          <Text bold color="yellow"> ↑↓ </Text><Text dimColor>Select  </Text>
          <Text bold color="yellow"> ↵ </Text><Text dimColor>Details  </Text>
          <Text bold color="yellow"> / </Text><Text dimColor>Search  </Text>
          <Text bold color="yellow"> ESC </Text><Text dimColor>Back  </Text>
          <Text bold color="yellow"> T </Text><Text dimColor>Timeline  </Text>
        </Box>
        <Box>
          <Text bold color="red"> Q </Text><Text dimColor>Quit</Text>
        </Box>
      </Box>
    </Box>
  );
}
