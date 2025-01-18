# Mind Matrix - Vector Database Sync for Obsidian

⚠️ **WARNING: This plugin is in early alpha stage. Please only use it with test vaults, not your primary vault.** ⚠️

Mind Matrix is an Obsidian plugin that seamlessly syncs your notes with a PostgreSQL vector database, enabling powerful knowledge retrieval and automation capabilities. By vectorizing your notes, you can leverage tools like n8n to create custom workflows and access your personal knowledge in new ways.

**Developer**: [Kevin Hahn](https://khw.io) | [@khwhahn](https://x.com/khwhahn)

## Overview

Mind Matrix creates and maintains a vector representation of your notes in a PostgreSQL database, allowing you to:
- Build powerful automation workflows using platforms like n8n
- Create semantic search applications with your personal knowledge
- Develop custom integrations using standard PostgreSQL connections

## Features

- Automatic synchronization of new notes
- Real-time updates when notes are modified
- Configurable exclusion rules for files and directories
- Vector embeddings for semantic similarity search
- PostgreSQL compatibility for broad integration support

## Installation

Please refer to the [INSTALL.md](./INSTALL.md) file for detailed installation and setup instructions.

## Usage

1. After installation, configure your PostgreSQL connection settings in the plugin settings tab
2. Set up any exclusion patterns for files or directories you don't want to sync
3. Run the initial sync using the ribbon icon or command palette
4. The plugin will automatically keep your vector database in sync as you add or modify notes

## For Developers

### Getting Started

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start development build:
   ```bash
   npm run dev
   ```

### Development Prerequisites

- Node.js v16 or higher
- PostgreSQL database with vector extension
- Basic understanding of TypeScript and Obsidian Plugin API

### Project Structure

```
mind-matrix/
├── src/
│   ├── main.ts                    # Plugin entry point and lifecycle management
│   ├── settings/
│   │   ├── SettingsTab.ts        # Settings UI component
│   │   └── Settings.ts           # Settings interface and defaults
│   ├── services/
│   │   ├── SupabaseService.ts    # Supabase database operations
│   │   ├── OpenAIService.ts      # OpenAI API and embedding generation
│   │   └── QueueService.ts       # Async queue for processing documents
│   ├── utils/
│   │   ├── TextSplitter.ts       # Document chunking and text processing
│   │   └── NotificationManager.ts # User feedback and progress tracking
│   └── models/
│       ├── DocumentChunk.ts      # Document chunk data structure
│       └── ProcessingTask.ts     # Queue task interface
├── tests/                        # Test files for each component
├── docs/                         # Documentation
│   ├── CONTRIBUTING.md          # Contribution guidelines
│   └── API.md                   # API documentation
└── types/                       # TypeScript type definitions
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests where applicable
5. Submit a pull request

We welcome contributions of all kinds:
- Bug fixes
- Feature improvements
- Documentation updates
- Test coverage improvements

### Building and Testing

```bash
# Run tests
npm test

# Build for production
npm run build
```

## API Documentation

For plugin development, refer to the [Obsidian Plugin API documentation](https://github.com/obsidianmd/obsidian-api).

## Support

If you encounter any issues or have questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review the installation guide for common problems

## License

MIT License

## Contact

- Website: [https://khw.io](https://khw.io)
- X/Twitter: [@khwhahn](https://x.com/khwhahn)
