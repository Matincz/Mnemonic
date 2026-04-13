// src/tui/components/search.tsx
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Memory } from "../../types";

interface SearchProps {
  query: string;
  onQueryChange: (q: string) => void;
  results: Memory[];
}

export function Search({ query, onQueryChange, results }: SearchProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        <Text>🔍 </Text>
        <TextInput value={query} onChange={onQueryChange} placeholder="Search memories..." />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {results.map((mem) => (
          <Box key={mem.id}>
            <Text color="cyan">[{mem.layer}]</Text>
            <Text> {mem.title} </Text>
            <Text dimColor>- {mem.summary.slice(0, 60)}</Text>
          </Box>
        ))}
        {query.length >= 2 && results.length === 0 && (
          <Text dimColor>No results found.</Text>
        )}
      </Box>
    </Box>
  );
}
