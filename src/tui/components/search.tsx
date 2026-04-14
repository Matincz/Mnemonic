// src/tui/components/search.tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Memory } from "../../types";

interface SearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: Memory[];
}

export function Search({ query, onQueryChange, results }: SearchProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="grey" flexGrow={1} width="100%">
      <Box paddingX={1} marginTop={-1}>
        <Text bold color="grey"> 🔎 SEARCH </Text>
      </Box>
      <Box padding={1} flexDirection="column">
        <Box borderStyle="single" borderColor="blue" paddingX={1}>
          <Text bold color="blue">Query: </Text>
          <TextInput value={query} onChange={onQueryChange} placeholder="Type to search memories..." />
        </Box>
        
        <Box marginTop={1} flexDirection="column">
          <Text bold dimColor>RESULTS ({results.length})</Text>
          {results.slice(0, 10).map((res) => (
            <Box key={res.id} marginTop={0}>
              <Text color="cyan">• </Text>
              <Text bold>{res.title}</Text>
              <Text dimColor> [{res.layer.toUpperCase()}]</Text>
            </Box>
          ))}
          {results.length === 0 && query !== "" && (
            <Text dimColor italic>No results found for "{query}"</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
