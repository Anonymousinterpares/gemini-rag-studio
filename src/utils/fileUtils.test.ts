import { describe, it, expect } from 'vitest';
import { generateFileId, isAllowedFileType } from './fileUtils';

describe('fileUtils', () => {
  describe('generateFileId', () => {
    it('should use the path if it contains directory separators', () => {
      const file = { path: 'folder/subfolder/file.txt', name: 'file.txt', size: 1024, lastModified: 123456789 };
      expect(generateFileId(file)).toBe('folder/subfolder/file.txt');
    });

    it('should combine name, size, and lastModified for individually dropped files', () => {
      const file = { path: 'file.txt', name: 'file.txt', size: 1024, lastModified: 123456789 };
      expect(generateFileId(file)).toBe('file.txt_1024_123456789');
    });
  });

  describe('isAllowedFileType', () => {
    it('should allow .docx and .pdf files', () => {
      expect(isAllowedFileType('document.docx')).toBe(true);
      expect(isAllowedFileType('report.pdf')).toBe(true);
    });

    it('should allow common text and code extensions', () => {
      expect(isAllowedFileType('script.ts')).toBe(true);
      expect(isAllowedFileType('styles.css')).toBe(true);
      expect(isAllowedFileType('README.md')).toBe(true);
    });

    it('should disallow binary extensions', () => {
      expect(isAllowedFileType('image.png')).toBe(false);
      expect(isAllowedFileType('archive.zip')).toBe(false);
      expect(isAllowedFileType('program.exe')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isAllowedFileType('DOCUMENT.DOCX')).toBe(true);
      expect(isAllowedFileType('SCRIPT.TS')).toBe(true);
    });
  });
});
