// src/tui/components/search.tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { MemorySearchResult } from "../../types";

interface SearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: MemorySearchResult[];
  loading: boolean;
}

export function Search({ query, onQueryChange, results, loading }: SearchProps) {
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
          {loading && <Text color="yellow">Searching hybrid index...</Text>}
          {results.slice(0, 10).map((res) => (
            <Box key={res.memory.id} marginTop={0} flexDirection="column">
              <Box>
              <Text color="cyan">• </Text>
                <Text bold>{res.memory.title}</Text>
                <Text dimColor> [{res.memory.layer.toUpperCase()}]</Text>
                <Text dimColor> score={res.score.toFixed(3)}</Text>
              </Box>
              <Box marginLeft={2}>
                <Text dimColor>{res.reasons.join(" + ")}</Text>
              </Box>
            </Box>
          ))}
          {!loading && results.length === 0 && query !== "" && (
            <Text dimColor italic>No results found for "{query}"</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
