// src/tui/components/status.tsx
import React from "react";
import { Box, Text } from "ink";

interface StatusProps {
  view: string;
  memoryCount: number;
}

export function StatusBar({ view, memoryCount }: StatusProps) {
  return (
    <Box borderStyle="single" paddingX={1} justifyContent="space-between">
      <Text>🧠 Memory Agent</Text>
      <Text dimColor>View: {view}</Text>
      <Text dimColor>{memoryCount} memories</Text>
      <Text dimColor>q:quit  /:search  t:timeline  1-4:layers</Text>
    </Box>
  );
}
