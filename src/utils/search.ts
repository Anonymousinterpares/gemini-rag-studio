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
      // Try to get error details from response body
      let details = '';
      try {
        const data = await response.json();
        details = data.details || data.error || '';
      } catch {
        details = response.statusText;
      }
      throw new Error(`Search failed: ${details || response.status}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.results || [];
  } catch (error) {
    console.error('Web search error:', error);
    throw error; // Re-throw to allow caller to handle or stop the loop
  }
}
