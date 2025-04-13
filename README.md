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

## Project Status

### Completed ✅
- Core database setup and configuration
- Development environment setup
- Basic plugin functionality
- File synchronization system
- Initial user interface

### In Progress 🚧
- Automated database setup for users
- Improved error handling and user feedback
- Documentation updates
- Performance optimizations

### Upcoming 📅
- Advanced search features
- Additional file type support
- Developer tools and debugging features
- Community features and collaboration tools

For detailed task tracking and progress, see [TASKS.md](TASKS.md).

## TODOs

### High Priority
- Implement automated database setup and connection testing
- Add user-friendly error messages and troubleshooting guides
- Create comprehensive documentation and tutorials

### Medium Priority
- Optimize performance for large vaults
- Add more configuration options
- Implement testing suite

### Low Priority
- Support for additional file types
- Advanced search features
- Developer tools and monitoring

See [TASKS.md](TASKS.md) for detailed task breakdown and progress tracking.

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

For further details on the plugin's API and development guidelines, please see the [Obsidian Plugin API documentation](https://github.com/obsidianmd/obsidian-api).

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

## Development

### Documentation
The project includes comprehensive documentation to help developers understand and contribute to the codebase:

- [ARCHITECTURE.md](ARCHITECTURE.md): Detailed overview of the system architecture, components, and data flow
- [TASKS.md](TASKS.md): Current sprint progress, upcoming tasks, and project backlog
- [DEVELOPMENT.md](DEVELOPMENT.md): Setup instructions, development workflow, and contribution guidelines

### Prerequisites
- Node.js (v16 or later)
- Yarn package manager
- PostgreSQL (v14 or later)
- Supabase account
- OpenAI API key (for embeddings)

### Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   yarn install
   ```