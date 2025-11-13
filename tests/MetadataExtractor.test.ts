import { MetadataExtractor } from '../services/MetadataExtractor';
import type { DocumentMetadata } from '../models/DocumentChunk';

describe('MetadataExtractor tag handling', () => {
  const baseMetadata: DocumentMetadata = {
    obsidianId: 'test',
    path: 'test',
    lastModified: Date.now(),
    created: Date.now(),
    size: 10
  };

  it('normalizes comma-separated tags in extractMetadataFromContent', async () => {
    const extractor = new MetadataExtractor({} as any, {} as any);
    const result = await extractor.extractMetadataFromContent('', baseMetadata, {
      tags: 'note, health, sports'
    });

    expect(result.tags).toEqual(expect.arrayContaining(['note', 'health', 'sports']));
    expect(result.tags).toHaveLength(3);
  });

  it('normalizes comma-separated tags when extracting metadata from a file', async () => {
    const fakeVault = {
      read: jest.fn().mockResolvedValue(`---\ntags: note, research, #science\n---\nBody of the file`)
    };
    const extractor = new MetadataExtractor(fakeVault as any, {} as any);
    const file = {
      path: 'Test.md',
      stat: { mtime: 1, ctime: 2, size: 3 },
      vault: fakeVault
    } as any;

    const metadata = await extractor.extractMetadata(file);

    expect(metadata.tags).toEqual(expect.arrayContaining(['note', 'research', 'science']));
    expect(metadata.tags).toHaveLength(3);
  });

  it('captures aliases, links, and inline tags from full metadata extraction', async () => {
    const fileContent = `---\naliases: Alternate Title\nsource: docs\nfile_id: 42\n---\nBody with [[Linked Note]] and [[Linked Note|alias]] #context`;
    const fakeVault = {
      read: jest.fn().mockResolvedValue(fileContent)
    };
    const extractor = new MetadataExtractor(fakeVault as any, {} as any);
    const file = {
      path: 'Test.md',
      stat: { mtime: 1, ctime: 2, size: 3 },
      vault: fakeVault
    } as any;

    const metadata = await extractor.extractMetadata(file);

    expect(metadata.aliases).toEqual(['Alternate Title']);
    expect(metadata.links).toEqual(['Linked Note']);
    expect(metadata.tags).toContain('context');
    expect(metadata.source).toBe('docs');
    expect(metadata.file_id).toBe('42');
  });
});
