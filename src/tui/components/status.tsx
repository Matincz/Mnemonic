// src/tui/components/header.tsx
import React from "react";
import { Box, Text } from "ink";
import type { RuntimeEvent, RuntimeStatus } from "../../ipc/runtime";

interface HeaderProps {
  view: string;
  memoryCount: number;
  runtime: RuntimeStatus;
  latestEvent?: RuntimeEvent;
}

export function Header({ view, memoryCount, runtime, latestEvent }: HeaderProps) {
  const statusColors = {
    watching: "green",
    backfill: "yellow",
    starting: "yellow",
    idle: "yellow",
    error: "red",
    stopped: "grey",
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="magenta">
        <Box>
          <Text color="magenta" bold>🧠 MEMORY</Text>
          <Text color="cyan" bold> AGENT</Text>
        </Box>
        <Box>
          <Text dimColor>daemon: </Text>
          <Text color={statusColors[runtime.state]} bold>● {runtime.state}</Text>
          <Text dimColor> | </Text>
          <Text color="blue" bold>{memoryCount}</Text>
          <Text dimColor> items</Text>
          <Text dimColor> | processed </Text>
          <Text color="cyan" bold>{runtime.processedSessions}</Text>
        </Box>
      </Box>
      <Box paddingX={1} marginTop={-1}>
        <Box borderStyle="single" borderColor="grey" paddingX={1}>
          <Text bold>MODE: </Text>
          <Text color="yellow">{view.toUpperCase()}</Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{latestEvent?.message ?? runtime.message}</Text>
      </Box>
    </Box>
  );
}
