// src/tui/components/timeline.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Memory } from "../../types";

interface TimelineProps {
  memories: Memory[];
  selectedIndex: number;
}

const LAYER_COLORS = {
  episodic: "cyan",
  semantic: "green",
  procedural: "yellow",
  insight: "magenta",
} as const;

export function Timeline({ memories, selectedIndex }: TimelineProps) {
  if (memories.length === 0) {
    return (
      <Box padding={1} borderStyle="round" borderColor="grey" width="100%">
        <Text dimColor italic>No memories found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="grey" flexGrow={1} width="100%">
      <Box paddingX={1} marginTop={-1}>
        <Text bold color="grey"> 📜 TIMELINE </Text>
      </Box>
      <Box flexDirection="column" padding={1}>
        {memories.slice(0, 15).map((mem, i) => {
          const isSelected = i === selectedIndex;
          const color = LAYER_COLORS[mem.layer];
          
          return (
            <Box key={mem.id} marginBottom={0}>
              <Text color={isSelected ? "yellow" : "grey"}>{isSelected ? "❯ " : "  "}</Text>
              <Text backgroundColor={isSelected ? "grey" : undefined}>
                <Text color={color} bold>[{mem.layer.slice(0, 4).toUpperCase()}]</Text>
                {" "}
                <Text color={isSelected ? "white" : "white"}>{mem.title.padEnd(40).slice(0, 40)}</Text>
                {" "}
                <Text dimColor italic>[{mem.sourceAgent.padEnd(8).slice(0, 8)}]</Text>
                {" "}
                <Text color="blue">★ {mem.salience.toFixed(1)}</Text>
              </Text>
            </Box>
          );
        })}
        {memories.length > 15 && (
          <Box marginTop={1} paddingX={1}>
            <Text dimColor italic>... and {memories.length - 15} more</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
