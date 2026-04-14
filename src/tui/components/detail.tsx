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
      <Box padding={1} borderStyle="round" borderColor="grey" flexGrow={1}>
        <Text dimColor italic>Select a memory to view details.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="grey" flexGrow={1} width="100%">
      <Box paddingX={1} marginTop={-1}>
        <Text bold color="grey"> 🔍 DETAIL: {memory.id.slice(0, 8)} </Text>
      </Box>
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan" underline>{memory.title}</Text>
        
        <Box marginTop={1} flexDirection="row">
          <Box borderStyle="single" borderColor="cyan" paddingX={1} marginRight={1}>
            <Text bold color="cyan">{memory.layer.toUpperCase()}</Text>
          </Box>
          <Box borderStyle="single" borderColor="blue" paddingX={1} marginRight={1}>
            <Text bold color="blue">{memory.sourceAgent.toUpperCase()}</Text>
          </Box>
          <Box borderStyle="single" borderColor="yellow" paddingX={1}>
            <Text bold color="yellow">SAL: {memory.salience.toFixed(2)}</Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="magenta" bold>Summary: </Text>
            <Text italic>{memory.summary}</Text>
          </Box>
          
          <Box borderStyle="round" borderColor="grey" paddingX={1} flexDirection="column">
            <Text bold dimColor>CONTEXT & DETAILS</Text>
            <Text>{memory.details}</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Tags: </Text>
          <Text color="green">{memory.tags.join(" ")}</Text>
        </Box>

        {memory.linkedMemoryIds.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="magenta" bold>Links: </Text>
            <Box flexDirection="row" flexWrap="wrap">
              {memory.linkedMemoryIds.map((id) => (
                <Box key={id} marginRight={1}>
                  <Text color="blue">→ {id.slice(0, 8)}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
