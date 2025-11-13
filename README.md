## Obsidian RAG
### A Customizable Obsidian Hybrid RAG Plugin for Obsidian Notes  
**Created by [George Freeney Jr.](https://github.com/GeorgeFreeneyJr)**  
**Maintained by [SMPL: Ai Automations](https://github.com/SMPL-Ai-Agency)**  

Obsidian RAG is a fork of the [MindMatrix](https://github.com/khwerhahn/MindMatrix) Obsidian plugin.  
It synchronizes your notes with a **Supabase vector store** and **Neo4j graph database** to create a Hybrid RAG system for AI automation platforms and large language models (LLMs) such as AI assistants.

It prioritizes **Ollama-powered embeddings** (local or cloud-hosted) for privacy and cost efficiency, with optional support for **OpenAI API** and compatible models.

This enables efficient knowledge retrieval and automation across multiple vaults. Build custom integrations, automate workflows with **n8n**, and turn your Second Brain into a dynamic, searchable resource accessible through AI tools — without mixing content between projects.  

For example, create a **Telegram bot** that searches your vectorized notes and GraphRAG entities in Neo4j for answers.  
An **n8n workflow** can integrate Perplexity or other search APIs to blend your personal knowledge with external data, delivering a portable, intelligent assistant.  

---

## Summary
Obsidian RAG connects your Obsidian vaults to both a Supabase vector store and a Neo4j graph database to create a **Hybrid RAG (Retrieval-Augmented Generation)** system.  

It pairs **semantic embeddings** (for context-aware retrieval) with **graph relationships** (for linked knowledge and entity mapping), allowing your notes to power intelligent assistants, automations, and advanced search tools — all while preserving project separation and privacy.

---

## Plugin Features
These are the built-in mechanisms and core behaviors the plugin implements.

- **Automatic note synchronization:** Detects new, edited, or deleted notes and syncs them in near-real-time to **Supabase (vector)** and **Neo4j (graph)**.  
- **Embedding generation service:** Uses **Ollama by default** for embeddings, with optional **OpenAI-compatible** models.  
- **Graph construction engine:** Builds Neo4j nodes and relationships for notes, tags, and entities — enabling GraphRAG-style semantic-graph queries.  
- **Queue and task management:** Handles sync jobs, retries, and parallel processing via an internal queue.  
- **Offline queue and reconciliation:** Stores unsent tasks locally and runs them once reconnected.  
- **Configurable exclusions:** Lets you exclude folders/files (e.g., templates, private journals, daily logs).  
- **Database setup automation:** Initializes Supabase tables, vector indexes, and Neo4j schemas automatically on first run.  
- **Connection status and error handling:** Displays status indicators, recovers gracefully, and retries failures.  
- **Progress tracking and notifications:** Shows in-app progress and sync alerts.  
- **Cross-device sync management:** Uses a unified sync-state file to keep multiple devices consistent.  
- **Extensible architecture:** Built with modular TypeScript services (`EmbeddingService`, `QueueService`, `SupabaseService`, etc.).  
- **n8n workflow hooks:** Provides triggers/endpoints for n8n to invoke sync, query, or embedding operations.  
- **Developer utilities:** Helper scripts for queries, resets, and release automation.

---

## Use Cases
Once configured, Obsidian RAG lets you automate and extend your knowledge base:

- **Sync multiple vaults safely:** Keep “Research,” “Business,” and “Personal” vaults independent while syncing to Supabase and Neo4j — no cross-project mixing.  
- **Semantic search and retrieval:** Ask natural-language questions using meaning-based search powered by **Ollama** (local or cloud) with optional **OpenAI-compatible APIs**.  
- **Graph-based knowledge exploration:** Visualize and navigate relationships between notes, tags, people, and topics in **Neo4j** for connected thinking and research.  
- **Automated workflows with n8n:** Run semantic and graph queries —or hybrid RAG + GraphRAG searches — and send results to **Telegram**, **Discord**, or dashboards.  
- **Build custom AI assistants:** Combine your private notes with external sources (e.g., **Perplexity**, web APIs) to create knowledge-driven agents.  
- **Local-first privacy mode:** Run embeddings and databases entirely offline for full data control.  
- **Cross-device synchronization:** Keep notes and metadata consistent via a shared **sync state file**.  
- **Offline operation:** Continue editing offline — updates queue locally and sync on reconnect.

---

## Installation
See [INSTALL.md](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/INSTALL.md) for details:
- Setting up Supabase with SQL  
- Configuring Ollama or OpenAI credentials  
- Plugin installation and configuration  
- n8n workflow examples (e.g., Telegram bot)  
- Advanced troubleshooting  

---

## Project Status
### Completed ✅
- Core database setup and configuration  
- Development environment setup  
- Basic plugin functionality  
- File synchronization system  
- Initial UI  

**Database Connection & Setup**
- Connection testing and status indicators  
- Table and index automation  
- Database reset and error handling  

**Core Services**
- SupabaseService (operations)  
- EmbeddingService (embeddings)  
- QueueService (tasks)  
- SyncManager (file management)  
- EventEmitter system  
- StatusManager (progress)  
- SyncDetectionManager  
- InitialSyncManager (batch processing)  

### In Progress 🚧
- Documentation updates  
- MindMatrix bug review and fixes  
- Fix Supabase deletion ID mismatch  
- Prevent double event registration  
- Repair `TextSplitter` (chunking and metadata)  
- Stabilize `removeExcludedFiles` (cleanup)  
- Performance optimizations and tests  

For task tracking and progress, see [TASKS.md](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/TASKS.md).

---

## For Developers
### Getting Started
```bash
git clone https://github.com/SMPL-Ai-Agency/Obsidian-RAG.git
cd Obsidian-RAG
yarn install
yarn dev
```

### Requirements
- Node.js v18+
- Yarn  
- Supabase (PostgreSQL + vector extension)  
- Neo4j 5.x  
- Obsidian Plugin API knowledge  

### Directory Structure
```text
Obsidian-RAG/
├── main.ts                       # Plugin entry point and lifecycle
├── settings/
│   ├── SettingsTab.ts             # Settings UI
│   └── Settings.ts                # Settings interface and defaults
├── services/
│   ├── EventEmitter.ts            # Inter-service communication
│   ├── InitialSyncManager.ts      # Initial vault sync
│   ├── MetadataExtractor.ts       # Metadata for sync
│   ├── OfflineQueueManager.ts     # Offline tasks
│   ├── EmbeddingService.ts        # Ollama/OpenAI embeddings
│   ├── QueueService.ts            # Async queue
│   ├── StatusManager.ts           # Progress tracking
│   ├── SupabaseService.ts         # Supabase operations
│   ├── SyncDetectionManager.ts    # Quiet sync detection
│   ├── SyncFileManager.ts         # Cross-device sync
│   └── __tests__/                 # Unit tests
├── utils/
│   ├── ErrorHandler.ts            # Centralized logging
│   ├── FileTracker.ts             # File event tracking
│   ├── NotificationManager.ts     # Notifications + progress bar
│   └── TextSplitter.ts            # Chunking and preprocessing
├── models/
│   ├── DocumentChunk.ts
│   ├── ObsidianRAGSettings.ts
│   ├── ProcessingTask.ts
│   ├── QueueEvents.ts
│   └── SyncModels.ts
├── scripts/
│   ├── query_tables.ts
│   └── release-utils.sh
├── sql/                           # Database schemas
├── tests/
├── styles.css
├── manifest.json
└── README.md
```

---

## Contributing
Contributions are welcome!  
Fork → Branch → Commit → Pull Request.  
Bug fixes, optimizations, and docs improvements are encouraged.

---

## Support
If you encounter issues:
- Open an issue on GitHub  
- Check existing issues  
- Consult [INSTALL.md](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/INSTALL.md)

---

## License
Licensed under the **MIT License**.  

© 2025 George Freeney Jr.  |  SMPL: Ai Automations

---

## Developer Documentation
- [Installation Guide](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/INSTALL.md)  
- [Development Guide](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/DEVELOPMENT.md)  
- [Architecture Overview](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/ARCHITECTURE.md)  
- [Changelog](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/CHANGELOG.md)  
- [Task Tracking](https://github.com/SMPL-Ai-Agency/Obsidian-RAG/blob/main/TASKS.md)


