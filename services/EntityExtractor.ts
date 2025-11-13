import OpenAI from 'openai';
import { DocumentMetadata } from '../models/DocumentChunk';
import { EmbeddingProviderSettings } from '../settings/Settings';
import { ErrorHandler } from '../utils/ErrorHandler';

export interface GraphEntity {
        id: string;
        name: string;
        type?: string;
        summary?: string;
        sourcePath?: string;
        importance?: number;
}

export interface GraphRelationship {
        sourceId: string;
        targetId: string;
        type: string;
        description?: string;
}

export interface EntityExtractionResult {
        entities: GraphEntity[];
        relationships: GraphRelationship[];
}

export class EntityExtractor {
        private openAIClient: OpenAI | null = null;

        constructor(
                private providerSettings: EmbeddingProviderSettings,
                private errorHandler: ErrorHandler,
                private projectName: string
        ) {
                this.initializeOpenAIClient();
        }

        public updateSettings(settings: EmbeddingProviderSettings, projectName?: string): void {
                this.providerSettings = settings;
                if (projectName) {
                        this.projectName = projectName;
                }
                this.initializeOpenAIClient();
        }

        public async extractFromDocument(content: string, metadata: DocumentMetadata): Promise<EntityExtractionResult | null> {
                const normalizedContent = content?.trim();
                if (!normalizedContent) {
                        return null;
                }
                const prompt = this.buildPrompt(normalizedContent.slice(0, 6000), metadata);

                if (this.providerSettings.ollama?.enabled) {
                        try {
                                const ollamaResult = await this.extractWithOllama(prompt);
                                if (ollamaResult) {
                                        return this.normalizeExtractionResult(ollamaResult, metadata);
                                }
                        } catch (error) {
                                this.errorHandler.handleError(error, { context: 'EntityExtractor.ollama' }, 'warn');
                                if (!this.providerSettings.ollama.fallbackToOpenAI) {
                                        return this.buildHeuristicResult(metadata);
                                }
                        }
                }

                if (this.openAIClient) {
                        try {
                                const aiResult = await this.extractWithOpenAI(prompt);
                                if (aiResult) {
                                        return this.normalizeExtractionResult(aiResult, metadata);
                                }
                        } catch (error) {
                                this.errorHandler.handleError(error, { context: 'EntityExtractor.openai' }, 'warn');
                        }
                }

                return this.buildHeuristicResult(metadata);
        }

        private initializeOpenAIClient(): void {
                if (this.providerSettings.openai?.apiKey) {
                        this.openAIClient = new OpenAI({ apiKey: this.providerSettings.openai.apiKey });
                } else {
                        this.openAIClient = null;
                }
        }

        private async extractWithOllama(prompt: string): Promise<any | null> {
                const { url, model } = this.providerSettings.ollama;
                if (!url || !model) {
                        throw new Error('Ollama configuration is incomplete.');
                }
                const normalizedUrl = url.replace(/\/+$/, '');
                const response = await fetch(`${normalizedUrl}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model,
                                prompt,
                                stream: false,
                                options: { temperature: 0.1 },
                        }),
                });

                if (!response.ok) {
                        throw new Error(`Ollama responded with status ${response.status}`);
                }

                const data = await response.json();
                const raw = typeof data?.response === 'string' ? data.response : JSON.stringify(data);
                return this.parseExtraction(raw);
        }

        private async extractWithOpenAI(prompt: string): Promise<any | null> {
                if (!this.openAIClient) return null;
                const response = await this.openAIClient.chat.completions.create({
                        model: this.getOpenAILanguageModel(),
                        temperature: 0.1,
                        messages: [
                                {
                                        role: 'system',
                                        content: 'You analyze Obsidian notes and extract entities/relationships. Respond ONLY in JSON.',
                                },
                                { role: 'user', content: prompt },
                        ],
                });
                const raw = response.choices?.[0]?.message?.content || '';
                return this.parseExtraction(raw);
        }

        private getOpenAILanguageModel(): string {
                const configured = this.providerSettings.openai?.model || 'gpt-4o-mini';
                if (configured.toLowerCase().includes('embedding')) {
                        return 'gpt-4o-mini';
                }
                return configured;
        }

        private buildPrompt(content: string, metadata: DocumentMetadata): string {
                return `Extract distinct entities and their relationships from the following Obsidian note.
Return JSON with this structure:
{"entities":[{"id":"string","name":"string","type":"Person|Concept|Project|Document|Other","summary":"short description","importance":1-5}],"relationships":[{"sourceId":"entity-id","targetId":"entity-id","type":"relation label","description":"optional context"}]}
File path: ${metadata.path}
Project: ${this.projectName}
---
${content}`;
        }

        private parseExtraction(raw: string): any | null {
                if (!raw) return null;
                const trimmed = raw.trim();
                let jsonPayload = trimmed;
                if (!trimmed.startsWith('{')) {
                        const start = trimmed.indexOf('{');
                        const end = trimmed.lastIndexOf('}');
                        if (start >= 0 && end > start) {
                                jsonPayload = trimmed.slice(start, end + 1);
                        } else {
                                return null;
                        }
                }
                try {
                        return JSON.parse(jsonPayload);
                } catch (error) {
                        this.errorHandler.handleError(error, { context: 'EntityExtractor.parse' }, 'warn');
                        return null;
                }
        }

        private normalizeExtractionResult(data: any, metadata?: DocumentMetadata): EntityExtractionResult {
                const entities: GraphEntity[] = Array.isArray(data?.entities)
                        ? data.entities.map((entity: any, index: number) => ({
                                  id: String(entity.id || `${metadata?.path || 'entity'}-${index}`),
                                  name: String(entity.name || entity.id || `Entity ${index + 1}`),
                                  type: entity.type || 'Concept',
                                  summary: entity.summary || entity.description || '',
                                  sourcePath: metadata?.path,
                                  importance: typeof entity.importance === 'number' ? entity.importance : undefined,
                          }))
                        : [];
                const relationships: GraphRelationship[] = Array.isArray(data?.relationships)
                        ? data.relationships
                                  .filter((rel: any) => rel?.sourceId && rel?.targetId)
                                  .map((rel: any, index: number) => ({
                                          sourceId: String(rel.sourceId),
                                          targetId: String(rel.targetId),
                                          type: rel.type || 'related_to',
                                          description: rel.description || '',
                                  }))
                        : [];
                return { entities, relationships };
        }

        private buildHeuristicResult(metadata: DocumentMetadata): EntityExtractionResult {
                const tagEntities: GraphEntity[] = (metadata.tags || []).map(tag => ({
                        id: `${metadata.path}-${tag}`,
                        name: tag,
                        type: 'Tag',
                        summary: `Tag detected in ${metadata.path}`,
                        sourcePath: metadata.path,
                }));
                const aliasEntities: GraphEntity[] = (metadata.aliases || []).map(alias => ({
                        id: `${metadata.path}-alias-${alias}`,
                        name: alias,
                        type: 'Alias',
                        summary: `Alias defined for ${metadata.path}`,
                        sourcePath: metadata.path,
                }));
                return {
                        entities: [...tagEntities, ...aliasEntities],
                        relationships: [],
                };
        }
}
