// src/wiki/types.ts
export type WikiPageType = "entity" | "concept" | "source" | "procedure" | "insight";

export interface WikiPage {
  slug: string;
  type: WikiPageType;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  wikilinks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WikiOperation {
  action: "create" | "update";
  type: WikiPageType;
  slug: string;
  title: string;
  content: string;
  reason: string;
}
