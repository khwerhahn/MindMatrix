import neo4j, { Driver, Session } from 'neo4j-driver';
import { DocumentChunk, DocumentMetadata } from '../models/DocumentChunk';
import { ObsidianRAGSettings, Neo4jSettings } from '../settings/Settings';
import { EntityExtractionResult } from './EntityExtractor';

export class Neo4jService {
        private static instance: Neo4jService | null = null;
        private driver: Driver;
        private projectName: string;
        private settings: Neo4jSettings;

        private constructor(settings: Neo4jSettings) {
                this.settings = settings;
                this.projectName = settings.projectName || 'obsidian-rag';
                this.driver = neo4j.driver(settings.url, neo4j.auth.basic(settings.username, settings.password));
        }

        public static async getInstance(settings: ObsidianRAGSettings): Promise<Neo4jService | null> {
                if (!settings.neo4j?.url || !settings.neo4j.username || !settings.neo4j.password) {
                        console.warn('Neo4j configuration is incomplete. Skipping graph service initialization.');
                        return null;
                }
                if (!Neo4jService.instance || Neo4jService.instance.requiresReinitialize(settings.neo4j)) {
                        await Neo4jService.instance?.close();
                        Neo4jService.instance = new Neo4jService(settings.neo4j);
                        await Neo4jService.instance.initializeSchema();
                }
                return Neo4jService.instance;
        }

        private requiresReinitialize(config: Neo4jSettings): boolean {
                return (
                        this.settings.url !== config.url ||
                        this.settings.username !== config.username ||
                        this.settings.password !== config.password ||
                        this.settings.database !== config.database ||
                        this.settings.projectName !== config.projectName
                );
        }

        private getSession(): Session {
                return this.driver.session({ database: this.settings.database || 'neo4j' });
        }

        private async initializeSchema(): Promise<void> {
                const session = this.getSession();
                try {
                        await session.run(
                                'CREATE CONSTRAINT document_project IF NOT EXISTS FOR (d:Document) REQUIRE (d.project_name, d.path) IS UNIQUE'
                        );
                        await session.run(
                                'CREATE CONSTRAINT chunk_project IF NOT EXISTS FOR (c:Chunk) REQUIRE (c.project_name, c.chunk_id) IS UNIQUE'
                        );
                        await session.run(
                                'CREATE CONSTRAINT entity_project IF NOT EXISTS FOR (e:Entity) REQUIRE (e.project_name, e.entity_id) IS UNIQUE'
                        );
                } finally {
                        await session.close();
                }
        }

        public async upsertDocumentGraph(
                metadata: DocumentMetadata,
                chunks: DocumentChunk[],
                extraction: EntityExtractionResult | null
        ): Promise<void> {
                const session = this.getSession();
                const chunkPayload = chunks.map(chunk => ({
                        id: (chunk.metadata as any)?.graphChunkId || `${metadata.path}::${chunk.chunk_index}`,
                        chunkIndex: chunk.chunk_index,
                        content: chunk.content,
                        preview: chunk.content.substring(0, 280),
                }));
                const documentProperties = {
                        projectName: this.projectName,
                        path: metadata.path,
                        title: metadata.path.split('/').pop() || metadata.path,
                        lastModified: metadata.lastModified,
                        created: metadata.created,
                        tags: metadata.tags || [],
                        aliases: metadata.aliases || [],
                        links: metadata.links || [],
                        size: metadata.size ?? 0,
                };
                try {
                        await session.executeWrite(async tx => {
                                await tx.run(
                                        `MERGE (doc:Document {project_name: $projectName, path: $path})
SET doc += {
        title: $title,
        last_modified: $lastModified,
        created: $created,
        tags: $tags,
        aliases: $aliases,
        links: $links,
        size: $size,
        updated_at: datetime()
}`,
                                        documentProperties
                                );
                                if (chunkPayload.length > 0) {
                                        await tx.run(
                                                `MATCH (doc:Document {project_name: $projectName, path: $path})
WITH doc
UNWIND $chunks AS chunk
MERGE (c:Chunk {project_name: $projectName, chunk_id: chunk.id})
SET c += {
        content: chunk.content,
        preview: chunk.preview,
        chunk_index: chunk.chunkIndex,
        updated_at: datetime()
}
MERGE (doc)-[rel:HAS_CHUNK]->(c)
SET rel.chunk_index = chunk.chunkIndex`,
                                                { ...documentProperties, chunks: chunkPayload }
                                        );
                                }
                                await tx.run(
                                        `MATCH (doc:Document {project_name: $projectName, path: $path})-[:HAS_CHUNK]->(chunk:Chunk {project_name: $projectName})
WHERE NOT chunk.chunk_id IN $chunkIds
DETACH DELETE chunk`,
                                        { ...documentProperties, chunkIds: chunkPayload.map(chunk => chunk.id) }
                                );
                                if (extraction?.entities?.length) {
                                        const entities = extraction.entities.map(entity => ({
                                                id: entity.id,
                                                name: entity.name,
                                                type: entity.type || 'Concept',
                                                summary: entity.summary || '',
                                                sourcePath: entity.sourcePath || metadata.path,
                                                importance: entity.importance ?? 1,
                                        }));
                                        await tx.run(
                                                `UNWIND $entities AS entity
MERGE (e:Entity {project_name: $projectName, entity_id: entity.id})
SET e += {
        name: entity.name,
        type: entity.type,
        summary: entity.summary,
        source_path: entity.sourcePath,
        importance: entity.importance,
        updated_at: datetime()
}`,
                                                { projectName: this.projectName, entities }
                                        );
                                        await tx.run(
                                                `MATCH (doc:Document {project_name: $projectName, path: $path})
WITH doc
UNWIND $entities AS entity
MATCH (e:Entity {project_name: $projectName, entity_id: entity.id})
MERGE (doc)-[rel:MENTIONS]->(e)
SET rel.updated_at = datetime(), rel.weight = entity.importance`,
                                                { ...documentProperties, entities }
                                        );
                                }
                                if (extraction?.relationships?.length) {
                                        const relationships = extraction.relationships.map(rel => ({
                                                sourceId: rel.sourceId,
                                                targetId: rel.targetId,
                                                type: rel.type || 'related_to',
                                                description: rel.description || '',
                                        }));
                                        await tx.run(
                                                `UNWIND $relationships AS relationship
MATCH (source:Entity {project_name: $projectName, entity_id: relationship.sourceId})
MATCH (target:Entity {project_name: $projectName, entity_id: relationship.targetId})
MERGE (source)-[rel:RELATES_TO {project_name: $projectName, type: relationship.type}]->(target)
SET rel.description = relationship.description,
    rel.updated_at = datetime()`,
                                                { projectName: this.projectName, relationships }
                                        );
                                }
                        });
                } finally {
                        await session.close();
                }
        }

        public async deleteDocument(path: string): Promise<void> {
                const session = this.getSession();
                try {
                        await session.executeWrite(tx =>
                                tx.run(
                                        `MATCH (doc:Document {project_name: $projectName, path: $path})
OPTIONAL MATCH (doc)-[:HAS_CHUNK]->(chunk:Chunk {project_name: $projectName})
WITH doc, collect(chunk) AS chunks
FOREACH (c IN chunks | DETACH DELETE c)
DETACH DELETE doc`,
                                        { projectName: this.projectName, path }
                                )
                        );
                } finally {
                        await session.close();
                }
        }

        public async close(): Promise<void> {
                await this.driver?.close();
        }
}
