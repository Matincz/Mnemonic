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
      <Box padding={1}>
        <Text dimColor>No memories yet. Start the daemon to begin collecting.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold underline>Timeline</Text>
      <Box flexDirection="column" marginTop={1}>
        {memories.slice(0, 20).map((mem, i) => (
          <Box key={mem.id}>
            <Text inverse={i === selectedIndex}>
              <Text color={LAYER_COLORS[mem.layer]}>[{mem.layer.slice(0, 4)}]</Text>
              {" "}
              <Text>{mem.title}</Text>
              {" "}
              <Text dimColor>({mem.sourceAgent}) s:{mem.salience.toFixed(1)}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
