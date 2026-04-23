import type { Memory } from "./types";

export type GraphFormat = "mermaid" | "dot" | "json";

interface GraphNode {
  id: string;
  title: string;
  layer: string;
  project?: string;
  sourceAgent: string;
  salience: number;
}

interface GraphEdge {
  from: string;
  to: string;
  type: "link" | "contradiction";
}

export function renderMemoryGraph(memories: Memory[], format: GraphFormat): string {
  const graph = buildGraph(memories);

  switch (format) {
    case "mermaid":
      return renderMermaid(graph.nodes, graph.edges);
    case "dot":
      return renderDot(graph.nodes, graph.edges);
    case "json":
      return `${JSON.stringify(graph, null, 2)}\n`;
  }
}

function buildGraph(memories: Memory[]) {
  const memoryIds = new Set(memories.map((memory) => memory.id));
  const nodes: GraphNode[] = memories.map((memory) => ({
    id: memory.id,
    title: memory.title,
    layer: memory.layer,
    project: memory.project,
    sourceAgent: memory.sourceAgent,
    salience: memory.salience,
  }));

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const memory of memories) {
    for (const target of memory.linkedMemoryIds) {
      if (!memoryIds.has(target)) continue;
      const key = `link:${memory.id}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: memory.id, to: target, type: "link" });
    }

    for (const target of memory.contradicts) {
      if (!memoryIds.has(target)) continue;
      const key = `contradiction:${memory.id}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: memory.id, to: target, type: "contradiction" });
    }
  }

  return { nodes, edges };
}

function renderMermaid(nodes: GraphNode[], edges: GraphEdge[]) {
  const lines = [
    "flowchart TD",
    ...nodes.map((node) => {
      const id = mermaidId(node.id);
      const details = [node.title, `(${node.layer})`, node.project ? `[${node.project}]` : ""]
        .filter(Boolean)
        .join("\\n");
      return `  ${id}["${escapeMermaid(details)}"]`;
    }),
    ...edges.map((edge) => {
      const from = mermaidId(edge.from);
      const to = mermaidId(edge.to);
      if (edge.type === "contradiction") {
        return `  ${from} -. contradicts .-> ${to}`;
      }
      return `  ${from} --> ${to}`;
    }),
  ];

  return `${lines.join("\n")}\n`;
}

function renderDot(nodes: GraphNode[], edges: GraphEdge[]) {
  const lines = [
    "digraph Mnemonic {",
    '  rankdir="LR";',
    '  node [shape="box", style="rounded"];',
    ...nodes.map((node) => {
      const label = [node.title, `(${node.layer})`, node.project ? `[${node.project}]` : ""]
        .filter(Boolean)
        .join("\\n");
      return `  "${node.id}" [label="${escapeDot(label)}"];`;
    }),
    ...edges.map((edge) => {
      if (edge.type === "contradiction") {
        return `  "${edge.from}" -> "${edge.to}" [style="dashed", color="red", label="contradicts"];`;
      }
      return `  "${edge.from}" -> "${edge.to}" [color="black", label="links"];`;
    }),
    "}",
  ];

  return `${lines.join("\n")}\n`;
}

function mermaidId(value: string) {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function escapeMermaid(value: string) {
  return value.replaceAll('"', '\\"');
}

function escapeDot(value: string) {
  return value.replaceAll('"', '\\"');
}
