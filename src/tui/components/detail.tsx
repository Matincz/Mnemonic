// src/tui/components/detail.tsx
import React from "react";
import { Box, Text } from "ink";
import type { Memory } from "../../types";

interface DetailProps {
  memory: Memory | null;
}

export function Detail({ memory }: DetailProps) {
  if (!memory) {
    return (
      <Box padding={1}>
        <Text dimColor>Select a memory to view details.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>{memory.title}</Text>
      <Box marginTop={1}>
        <Text dimColor>Layer: </Text><Text color="cyan">{memory.layer}</Text>
        <Text dimColor>  Source: </Text><Text>{memory.sourceAgent}</Text>
        <Text dimColor>  Salience: </Text><Text>{memory.salience.toFixed(2)}</Text>
      </Box>
      {memory.project && (
        <Box><Text dimColor>Project: </Text><Text>{memory.project}</Text></Box>
      )}
      <Box><Text dimColor>Tags: </Text><Text>{memory.tags.join(", ")}</Text></Box>
      <Box><Text dimColor>Created: </Text><Text>{memory.createdAt}</Text></Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold underline>Summary</Text>
        <Text>{memory.summary}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold underline>Details</Text>
        <Text>{memory.details}</Text>
      </Box>
      {memory.linkedMemoryIds.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold underline>Links</Text>
          {memory.linkedMemoryIds.map((id) => (
            <Text key={id}>→ {id}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
