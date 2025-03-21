# Mind Matrix - Vector Database Sync for Obsidian

⚠️ **WARNING: This plugin is in early alpha stage. Please only use it with test vaults, not your primary vault.** ⚠️

Mind Matrix is an Obsidian plugin that seamlessly synchronizes your notes with a Supabase vector database. By leveraging AI-powered embeddings and semantic search capabilities, it enables powerful knowledge retrieval and automation. Use it to build custom integrations, automate workflows with tools like n8n, and transform your personal knowledge base into a searchable, dynamic resource.

I've built this to make my Obsidian vault searchable through AI tools. For example, I have a Telegram Bot set up that I can ask questions on-the-go, and it searches my vectorized vault data to provide answers. The n8n workflow integrates with Perplexity to augment my personal knowledge with external information when needed, creating a powerful knowledge assistant that travels with me.

---

## Overview

Mind Matrix creates and maintains vector representations of your notes in a Supabase (PostgreSQL) database, allowing you to:

- Build powerful automation workflows using platforms like n8n.
- Create semantic search applications using your personal knowledge.
- Develop custom integrations through standard PostgreSQL connections.

---

## Features

- Automatic synchronization of new and modified notes.
- Real-time updates as notes are added or edited.
- Configurable exclusion rules for files and directories.
- Generation of vector embeddings for semantic similarity search.
- Robust offline support with an operation queue and reconciliation.
- Cross-device coordination via a dedicated sync file.

---

## Installation

For detailed installation and setup instructions, please refer to the [INSTALL.md](./INSTALL.md) file.

This includes:
- Setting up Supabase with the required SQL
- Configuring OpenAI API credentials
- Plugin installation steps
- Detailed configuration operations
- n8n workflow setup for Telegram Chatbot (optional and customizable)

---

## Project Status and TODOs

Mind Matrix is under active development. The following tasks are planned for upcoming releases. Feel free to contribute or suggest additional features.

### High Priority
- **Thorough Testing:** Implement comprehensive tests for large vaults and concurrent operations
- **Live Cycle Testing:** Create automated tests that verify file creation, modification, and deletion are properly reflected in the database
- **UI Refinement:** Clean up and improve the settings UI for better user experience
- **Documentation Updates:** Align documentation with the current state of the plugin

### Medium Priority
- **Performance Optimization:** Improve handling of large vaults with many files
- **Integration Guide:** Create dedicated documentation for n8n integration and Telegram bot setup
- **Setup Guide Improvements:** Add clearer step-by-step instructions with screenshots
- **Public Repository Setup:** Prepare GitHub repo for public collaboration and pull requests

### Technical Debt
- **Code Refactoring:** Further modularize components for better maintainability
- **Error Handling:** Enhance error reporting and recovery mechanisms
- **Logging System:** Improve the logging system for better debugging
- **Unit Test Coverage:** Increase test coverage across core components

### Future Features
- **In-App Semantic Search:** Add a native search interface within Obsidian
- **Alternative Embedding Providers:** Support for other embedding services beyond OpenAI
- **Enhanced Metadata Extraction:** Improve handling of tags, links, and other metadata
- **Visualization Tools:** Add tools to visualize connections between notes
- **Multi-Model Support:** Allow using different embedding models for different types of content

---

## For Developers

### Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/mind-matrix.git
   cd mind-matrix
   ```
2. Install dependencies using yarn:
   ```bash
   yarn install
   ```
3. Start the development build:
   ```bash
   yarn dev
   ```

### Development Prerequisites

- Node.js v16 or higher
- Yarn
- A Supabase (PostgreSQL) database with the vector extension enabled
- Familiarity with the Obsidian Plugin API

### Project Structure

```
mind-matrix/
├── src/
│   ├── main.ts                    # Plugin entry point and lifecycle management
│   ├── settings/
│   │   ├── SettingsTab.ts         # Settings UI component
│   │   └── Settings.ts            # Settings interface and defaults
│   ├── services/
│   │   ├── SupabaseService.ts     # Supabase database operations
│   │   ├── OpenAIService.ts       # OpenAI API and embedding generation
│   │   ├── QueueService.ts        # Async task queue with event emissions
│   │   ├── SyncFileManager.ts     # Cross-device sync file management
│   │   ├── InitialSyncManager.ts  # Initial vault synchronization
│   │   ├── SyncDetectionManager.ts# Detects quiet sync periods
│   │   ├── OfflineQueueManager.ts # Handles operations during offline periods
│   │   └── EventEmitter.ts        # Inter-service event communication
│   ├── utils/
│   │   ├── TextSplitter.ts        # Document chunking and text processing
│   │   ├── NotificationManager.ts # User notifications and fixed progress bar
│   │   ├── FileTracker.ts         # Tracks file events and sync state
│   │   └── ErrorHandler.ts        # Centralized error logging and recovery
│   └── models/
│       ├── DocumentChunk.ts       # Document chunk and metadata structures
│       └── ProcessingTask.ts      # Task queue interfaces and error types
├── tests/                         # Unit and integration test files
├── docs/                          # Documentation files
│   ├── CONTRIBUTING.md           # Contribution guidelines
│   └── API.md                    # API documentation
├── types/                         # Additional TypeScript type definitions
├── manifest.json                  # Plugin manifest file
└── README.md                      # This documentation file
```

### Contributing

We welcome contributions to improve Mind Matrix. To contribute:

1. Fork the repository.
2. Create a feature branch.
3. Implement your changes along with tests.
4. Submit a pull request with a clear description of your changes.

Contributions of all kinds are welcome, including bug fixes, feature improvements, documentation updates, and test coverage enhancements.

### Building and Testing

To run tests and build the plugin:

```bash
# Run tests
yarn test

# Build for production
yarn build
```

---

## API Documentation

For further details on the plugin's API and development guidelines, please see the [Obsidian Plugin API documentation](https://github.com/obsidianmd/obsidian-api) as well as our internal [API.md](./docs/API.md) file.

---

## Support

If you encounter any issues or have questions:

- Open an issue on GitHub.
- Search existing issues for solutions.
- Consult the [INSTALL.md](./INSTALL.md) guide for troubleshooting.

---

## License

This project is licensed under the MIT License.

---

## Contact

- **Website**: [https://khw.io](https://khw.io)
- **X/Twitter**: [@khwhahn](https://x.com/khwhahn)
