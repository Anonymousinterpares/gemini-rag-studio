/**
 * Generates a unique ID for an AppFile.
 * For files with a unique path (e.g., from folder drops), the path is used as the ID.
 * For individually dropped files (where path might just be the file name),
 * a combination of name, size, and lastModified is used to ensure uniqueness.
 * @param file The AppFile object.
 * @returns A unique string ID for the file.
 */
export const generateFileId = (file: { path: string; name: string; size: number; lastModified: number }): string => {
  // If the path contains directory separators, it's likely from a folder drop and the path is unique.
  if (file.path.includes('/') || file.path.includes('\\')) {
    return file.path;
  }
  // For individually dropped files, combine name, size, and lastModified for uniqueness.
  // This creates a reasonably unique ID. For absolute uniqueness, a UUID library could be used.
  return `${file.name}_${file.size}_${file.lastModified}`;
};

/**
 * A set of common text/code file extensions that are generally safe to read.
 * This list is curated to avoid common binary or unreadable file types.
 */
const allowedTextExtensions = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.xml',
  '.yml', '.yaml', '.csv', '.log', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.go', '.rb', '.php', '.sh', '.bat', '.ps1', '.sql', '.vue', '.svelte', '.toml',
  '.ini', '.cfg', '.conf', '.env', '.gitignore', '.editorconfig', '.prettierrc',
  '.eslintrc', '.babelrc', '.npmrc', '.yarnrc', '.lock', '.project', '.settings',
  '.classpath', '.buildpath', '.gitattributes', '.gitmodules', '.gitconfig',
  '.prettierignore', '.eslintignore', '.dockerignore', '.npmignore', '.flowconfig',
  '.graphqlrc', '.d.ts', '.map', // Common development-related text files
]);

/**
 * A set of common binary or unreadable file extensions that should be explicitly prevented.
 */
const disallowedBinaryExtensions = new Set([
  '.exe', '.dll', '.bin', '.zip', '.tar', '.gz', '.rar', '.7z', '.mp3', '.mp4',
  '.avi', '.mov', '.wmv', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff',
  '.ico', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.wasm',
  '.sqlite', '.db', '.dat', '.mdb', '.accdb', '.iso', '.dmg', '.img', '.vmdk',
  '.vhd', '.vdi', '.bak', '.tmp', '.temp', '.swp', '.swo', '.obj', '.lib', '.out',
  '.class', '.jar', '.war', '.ear', '.apk', '.ipa', '.dmg', '.deb', '.rpm',
  '.msi', '.dmg', '.pkg', '.crx', '.xpi', '.vsix', '.node', '.pyd', '.so',
  '.DS_Store', // macOS specific metadata file
]);

/**
 * Checks if a file extension is considered a readable text/document file.
 * This function explicitly allows .docx and .pdf, and then checks against
 * a curated list of allowed text extensions and disallowed binary extensions.
 * @param filename The name of the file.
 * @returns True if the file is allowed, false otherwise.
 */
export const isAllowedFileType = (filename: string): boolean => {
  const lowerCaseFilename = filename.toLowerCase();
  const fileExtension = lowerCaseFilename.substring(lowerCaseFilename.lastIndexOf('.'));

  // Explicitly allowed document types (as per user's initial confirmation)
  if (lowerCaseFilename.endsWith('.docx') || lowerCaseFilename.endsWith('.pdf')) {
    return true;
  }

  // Explicitly disallowed binary types
  if (disallowedBinaryExtensions.has(fileExtension)) {
    return false;
  }

  // Allow if it's in the general allowed text extensions set
  return allowedTextExtensions.has(fileExtension);
};