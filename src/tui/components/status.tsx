// src/tui/components/header.tsx
import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  view: string;
  memoryCount: number;
  watcherStatus: "active" | "idle" | "error";
}

export function Header({ view, memoryCount, watcherStatus }: HeaderProps) {
  const statusColors = {
    active: "green",
    idle: "yellow",
    error: "red",
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="magenta">
        <Box>
          <Text color="magenta" bold>🧠 MEMORY</Text>
          <Text color="cyan" bold> AGENT</Text>
        </Box>
        <Box>
          <Text dimColor>watcher: </Text>
          <Text color={statusColors[watcherStatus]} bold>● {watcherStatus}</Text>
          <Text dimColor> | </Text>
          <Text color="blue" bold>{memoryCount}</Text>
          <Text dimColor> items</Text>
        </Box>
      </Box>
      <Box paddingX={1} marginTop={-1}>
        <Box borderStyle="single" borderColor="grey" paddingX={1}>
          <Text bold>MODE: </Text>
          <Text color="yellow">{view.toUpperCase()}</Text>
        </Box>
      </Box>
    </Box>
  );
}
