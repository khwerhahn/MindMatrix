# Installation Guide

## For Normal Users

### Prerequisites

Before you begin, ensure you have:
- [Obsidian](https://obsidian.md/) installed
- A [Supabase](https://supabase.com) account
- Access to an [Ollama](https://ollama.com/) server (local or remote)
- *(Optional)* An [OpenAI](https://platform.openai.com/) API key for fallback embeddings

### Installation Steps

1. **Install the Plugin**

   #### Method 1: Through Obsidian (Recommended)
   - Open Obsidian Settings
   - Go to Community Plugins
   - Search for "Obsidian RAG"
   - Click Install and Enable

   #### Method 2: Manual Installation
   - Download the latest release from [GitHub Releases](https://github.com/smpl-ai-automations/obsidian-rag/releases)
   - Extract the files to your vault's plugins directory:
     ```
     .obsidian/plugins/obsidian-rag/
     ```
   - Restart Obsidian
   - Enable the plugin in Community Plugins settings

2. **Set Up Supabase**
   - Create a new Supabase project at [supabase.com](https://supabase.com)
   - Go to Project Settings > Database
   - Copy your database password
   - Go to Project Settings > API
   - Copy your Project URL

3. **Configure the Plugin**
   - Open Obsidian RAG settings in Obsidian
   - Enter your Supabase credentials:
     - Project URL
     - Database Password
   - Configure the Embeddings section:
     - Confirm the Ollama server URL and model (defaults to `http://localhost:11434` and `nomic-embed-text`)
     - Enable or disable Ollama usage as needed
     - (Optional) Provide an OpenAI API key to enable fallback embedding generation
   - Click "Initialize Database" to create the required tables

4. **Start Using**
   - The plugin will automatically sync your notes
   - Use the command palette to search your knowledge base
   - Configure exclusion patterns if needed

## For Developers

### Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Yarn](https://yarnpkg.com/) package manager
- [PostgreSQL](https://www.postgresql.org/) (v14 or higher)
- [jq](https://stedolan.github.io/jq/) (for password encoding)
- [coreutils](https://www.gnu.org/software/coreutils/) (for timeout command)

The inspiration for this plugin came from watching Nate Herk's YouTube video [Step by Step: RAG AI Agents Got Even Better](https://youtu.be/wEXrbtqNIqI?t=323). This is great to watch to setup your Telegram Chatbot using n8n to connect to the Supabase database. I made an "Obsidian" workflow which I can plug into other n8n workflows to get information from my Obsidian vault in different scenarios. It has made retrieving knowledge from my vault so much easier and more practical in different use cases.

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/smpl-ai-automations/obsidian-rag.git
   cd obsidian-rag
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```

3. **Set up environment variables**
   - Copy `.env.template` to `.env`:
     ```bash
     cp .env.template .env
     ```
   - Update the `.env` file with your Supabase credentials:
     ```
     SUPABASE_URL=https://your-project-ref.supabase.co
     SUPABASE_DB_PASSWORD=your-database-password
     ```

4. **Initialize the project**
   ```bash
   make init
   ```
   This command will:
   - Check for required tools
   - Verify environment variables
   - Test the database connection
   - Set up the database schema

### Available Commands

#### Development
- `make dev` - Start the development server
- `make test-db` - Test the database connection
- `make reset` - Reset and set up the database

#### Database Management
- `make install-postgres` - Install PostgreSQL if not already installed
- `make test-db` - Test the database connection
- `make reset` - Reset the database and run setup scripts

#### Release Management
- `make release` - Create a patch release (default)
- `make release-major` - Create a major release
- `make release-minor` - Create a minor release
- `make release-patch` - Create a patch release

The release workflow will:
1. Check for a clean working directory
2. Verify we're on the main branch
3. Bump the version number
4. Generate a changelog
5. Create and push a git tag

### Troubleshooting

#### Database Connection Issues

If you encounter database connection issues:

1. **Check IP Address Restrictions**
   - Run `make test-db` to see your current IP address
   - Add this IP to your Supabase project's network restrictions
   - Wait a few minutes for changes to take effect

2. **Verify Connection Details**
   - Ensure your `SUPABASE_URL` and `SUPABASE_DB_PASSWORD` are correct
   - Check if the project reference matches your Supabase dashboard
   - Verify there are no network restrictions or firewall rules blocking the connection

3. **Install Required Tools**
   If you see errors about missing commands:
   - `psql`: Install PostgreSQL with `make install-postgres`
   - `jq`: Install with `brew install jq`
   - `timeout`: Install with `brew install coreutils`

#### Release Issues

If you encounter issues during release:

1. **Working Directory Not Clean**
   - Commit or stash any changes before running release commands
   - Use `git status` to check for uncommitted changes

2. **Not on Main Branch**
   - Switch to the main branch with `git checkout main`
   - Ensure all changes are merged before releasing

3. **Version Bump Issues**
   - Check `manifest.json` and `package.json` for correct version format
   - Ensure you have write permissions to these files

### Support

If you encounter any issues not covered in this guide:
1. Check the error messages for specific details
2. Review the troubleshooting steps above
3. If the issue persists, please open an issue in the repository
