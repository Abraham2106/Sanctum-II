import { requestUrl } from "obsidian";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
}

export async function searchTavily(apiKey: string, query: string, maxResults = 5): Promise<TavilyResponse> {
  const response = await requestUrl({
    url: "https://api.tavily.com/search",
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
    }),
  });

  return response.json as TavilyResponse;
}

export function formatWebContext(results: TavilyResult[], answer?: string): string {
  let ctx = "";
  if (answer) {
    ctx += `Resumen de búsqueda web:\n${answer}\n\n`;
  }
  ctx += "Resultados de búsqueda web:\n";
  for (const r of results) {
    ctx += `- [${r.title}](${r.url})\n  ${r.content.slice(0, 500)}\n`;
  }
  return ctx;
}
