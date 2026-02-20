export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

/**
 * Performs a web search using the local proxy.
 * @param query The search query string.
 * @returns A promise that resolves to an array of search results.
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error(`Search failed with status: ${response.status}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.results || [];
  } catch (error) {
    console.error('Web search error:', error);
    return [];
  }
}
