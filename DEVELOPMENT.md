# Development Guide

## Prerequisites
- Node.js (v16 or later)
- Yarn package manager
- PostgreSQL (v14 or later)
- Supabase account
- OpenAI API key (for embeddings)

## Initial Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   yarn install
   ```
3. Create `.env` file:
   ```bash
   cp .env.test .env
   ```
4. Update `.env` with your credentials:
   - Supabase project URL
   - Supabase database password
   - OpenAI API key
5. Initialize the project:
   ```bash
   make init
   ```

## Development Workflow

### Starting Development Server
```bash
make dev
```

### Database Management

#### Testing Connection
```bash
make test-db
```

#### Resetting Database
```bash
make reset
```

### Code Structure
- `src/`: Source code
  - `components/`: Obsidian UI components
    - Settings UI
    - Status indicators
    - Progress tracking
  - `services/`: Business logic
    - `SupabaseService.ts`: Database interactions
    - `OpenAIService.ts`: Embeddings generation
    - `QueueService.ts`: Task processing
    - `SyncManager.ts`: Synchronization
    - `StatusManager.ts`: State management
  - `types/`: TypeScript definitions
  - `utils/`: Utility functions
    - `TextSplitter.ts`: Document chunking
    - `ErrorHandler.ts`: Error management
    - `NotificationManager.ts`: User feedback
- `sql/`: Database scripts
  - `setup.sql`: Initial database setup
  - `reset.sql`: Database reset script

### Core Services Implementation

#### SupabaseService
- Handles database connections
- Manages document chunks
- Processes search queries
- Tracks file status

#### OpenAIService
- Generates embeddings
- Implements rate limiting
- Handles API errors
- Manages API keys

#### QueueService
- Processes tasks concurrently
- Implements retry logic
- Provides progress updates
- Handles task prioritization

#### SyncManager
- Manages sync file
- Tracks file changes
- Handles database sync
- Provides fallback mechanisms

### Testing
- Run tests:
  ```bash
  yarn test
  ```
- Run tests in watch mode:
  ```bash
  yarn test:watch
  ```
- Test categories:
  - Database operations
  - Embedding generation
  - Task processing
  - Sync mechanisms
  - Error handling
  - UI components

### Code Style
- Use Prettier for formatting
- Follow TypeScript best practices
- Write meaningful commit messages
- Document complex functions
- Add type definitions
- Include error handling

### Deployment
1. Build the plugin:
   ```bash
   yarn build
   ```
2. Copy the built files to your Obsidian plugins directory
3. Verify the sync file is created
4. Test database connection
5. Verify embeddings generation

## Troubleshooting

### Database Connection Issues
1. Check your IP is allowed in Supabase settings
2. Verify database credentials
3. Test connection with `make test-db`
4. Check network restrictions
5. Verify port accessibility

### Development Server Issues
1. Clear node_modules and reinstall
2. Check for port conflicts
3. Verify environment variables
4. Check OpenAI API key
5. Verify Supabase connection

### Sync Issues
1. Check sync file integrity
2. Verify database state
3. Check file permissions
4. Monitor error logs
5. Verify chunk processing

## Contributing
1. Create a feature branch
2. Make your changes
3. Run tests
4. Update documentation
5. Submit a pull request

## Resources
- [Obsidian Plugin Documentation](https://docs.obsidian.md/Plugins)
- [Supabase Documentation](https://supabase.com/docs)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs) 