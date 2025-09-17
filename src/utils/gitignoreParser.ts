/**
 * Parses .gitignore content and provides a function to check if a path should be ignored.
 * Supports basic .gitignore patterns (comments, blank lines, negation, directory matching).
 */
export class GitignoreParser {
  private ignorePatterns: RegExp[] = [];
  private acceptPatterns: RegExp[] = [];

  constructor(gitignoreContent: string) {
    this.parse(gitignoreContent);
  }

  private parse(content: string) {
    const lines = content.split('\n');
    for (let line of lines) {
      line = line.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      let isNegated = false;
      if (line.startsWith('!')) {
        isNegated = true;
        line = line.substring(1);
      }

      // Handle directory-only patterns (ending with /)
      const isDirectoryOnly = line.endsWith('/');
      if (isDirectoryOnly) {
        line = line.slice(0, -1); // Remove trailing slash for regex
      }

      // Convert .gitignore pattern to regex
      // Escape special regex characters, but keep * and ? for globbing
      let regexPattern = line
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special characters
        .replace(/\*\*/g, '(.+)') // Support ** for any number of directories
        .replace(/\*/g, '[^/]*') // Support * for any characters except /
        .replace(/\?/g, '.'); // Support ? for any single character

      // Anchor patterns:
      // If pattern doesn't contain '/', it matches against the basename of the file
      // or against the path relative to the .gitignore file.
      // For simplicity, we'll treat patterns without '/' as matching anywhere in the path for now,
      // but a more robust implementation would consider the .gitignore file's location.
      if (!line.includes('/')) {
        regexPattern = `(?:^|/)${regexPattern}`;
      }

      // If it's a directory-only pattern, ensure it matches only directories
      if (isDirectoryOnly) {
        regexPattern = `${regexPattern}/?`; // Match directory itself or its contents
      }

      const regex = new RegExp(regexPattern, 'i'); // Case-insensitive for common use

      if (isNegated) {
        this.acceptPatterns.push(regex);
      } else {
        this.ignorePatterns.push(regex);
      }
    }
  }

  /**
   * Checks if a given path should be ignored based on the parsed .gitignore rules.
   * @param filePath The path to check (e.g., "src/components/MyComponent.tsx" or "node_modules/").
   * @returns True if the path should be ignored, false otherwise.
   */
  shouldIgnore(filePath: string): boolean {
    // Normalize path to use forward slashes
    const normalizedPath = filePath.replace(/\\/g, '/');

    let ignored = false;
    for (const pattern of this.ignorePatterns) {
      if (pattern.test(normalizedPath)) {
        ignored = true;
        break;
      }
    }

    // If ignored by an ignore pattern, check if it's re-included by an accept pattern
    if (ignored) {
      for (const pattern of this.acceptPatterns) {
        if (pattern.test(normalizedPath)) {
          ignored = false;
          break;
        }
      }
    }

    return ignored;
  }
}