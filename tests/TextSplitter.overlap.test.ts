import { TextSplitter } from '../utils/TextSplitter';
import type { DocumentMetadata } from '../models/DocumentChunk';
import type { ErrorHandler } from '../utils/ErrorHandler';
import { Vault } from 'obsidian';

describe('TextSplitter overlap handling', () => {
        const metadata: DocumentMetadata = {
                obsidianId: 'note',
                path: 'note',
                lastModified: 1,
                created: 1,
                size: 1,
                customMetadata: {},
        };
        const errorHandler = { handleError: jest.fn() } as unknown as ErrorHandler;

        it('applies chunk overlap text to the previous chunk when multiple chunks exist', async () => {
                const splitter = new TextSplitter(new Vault() as any, errorHandler, {
                        chunkSize: 60,
                        chunkOverlap: 8,
                        minChunkSize: 10,
                });
                const content = 'Paragraph one has multiple sentences. Another sentence follows.\n\nParagraph two continues with even more words to ensure chunking.';

                const chunks = await splitter.splitDocument(content, metadata);

                expect(chunks.length).toBeGreaterThan(1);
                const overlap = chunks[1].content.substring(0, 8);
                expect(chunks[0].content.endsWith(`\n${overlap}`)).toBe(true);
        });

        it('leaves single chunks untouched even when overlap is configured', async () => {
                const splitter = new TextSplitter(new Vault() as any, errorHandler, {
                        chunkSize: 500,
                        chunkOverlap: 50,
                        minChunkSize: 10,
                });
                const content = 'Short paragraph that remains as a single chunk.';

                const chunks = await splitter.splitDocument(content, metadata);

                expect(chunks).toHaveLength(1);
                expect(chunks[0].content).toBe(content);
        });
});
