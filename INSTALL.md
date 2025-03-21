# Installation Guide

## Prerequisites

Before installing Mind Matrix, ensure you have:

1. The latest version of Obsidian installed.
2. A Supabase account with an active project.
3. An OpenAI API key for generating embeddings.

The inspiration for this plugin came from watching Nate Herk's YouTube video [Step by Step: RAG AI Agents Got Even Better](https://youtu.be/wEXrbtqNIqI?t=323). This is great to watch to setup your Telegram Chatbot using n8n to connect to the Supabase database. I made an "Obsidian" workflow which I can plug into other n8n workflows to get information from my Obsidian vault in different scenarios. It has made retrieving knowledge from my vault so much easier and more practical in different use cases.

---

## Installation Steps

### 1. Install the Plugin

#### From Obsidian Community Plugins

1. Open Obsidian Settings.
2. Navigate to **Community Plugins**.
3. Search for **Mind Matrix**.
4. Click **Install**, then **Enable**.

#### Manual Installation

1. Download the latest release from the GitHub releases page.
2. Extract the files to your vault's plugins directory:
   `.obsidian/plugins/mind-matrix/`
3. Restart Obsidian.
4. Enable the plugin in the **Community Plugins** settings.

---

### 2. Set Up Supabase

1. **Create a New Supabase Project:**
   - Visit [Supabase](https://supabase.com) and sign in.
   - Click **New Project**.
   - Fill in the project details and create your project.

2. **Set Up the Database Schema:**
   - Open your Supabase project dashboard.
   - Click on **SQL Editor** in the left sidebar.
   - Create a new query and copy-paste the SQL setup script from the [sql/setup.sql](sql/setup.sql)` file in the repository.
   - Execute the script to set up the necessary tables and functions.

   > **Note:** The setup script creates tables for document chunks and file status tracking, sets up the vector extension for embeddings, and creates functions for semantic search. For the most up-to-date version, always refer to the `sql/setup.sql` file in the repository.

3. **Obtain API Credentials:**
   - Go to **Project Settings > API**.
   - Copy the **Project URL** and the `service_role` API key.
   - Keep these credentials secure; you will need them during plugin configuration.

---

### 3. Get Your OpenAI API Key

1. Visit [OpenAI API Keys](https://platform.openai.com/api-keys).
2. Sign in to your account or create a new one.
3. Create a new API key.
4. Copy the API key for use in the plugin configuration.

---

### 4. Configure the Plugin

1. Open **Obsidian Settings**.
2. Navigate to the **Mind Matrix** settings tab.
3. Enter your API credentials:
   - **Supabase URL** (your Project URL)
   - **Supabase API Key** (the `service_role` key)
   - **OpenAI API Key**
4. Optionally, configure exclusion patterns:
   - **Excluded Folders** (e.g., `.obsidian`, `node_modules`)
   - **Excluded File Types** (e.g., `.mp3`, `.jpg`, `.png`)
   - **Excluded File Prefixes** (e.g., `_`, `.`)

---

### 5. Initial Setup

1. Initialize your vault within the plugin (this will generate a unique vault identifier).
2. Enable auto-sync if desired.
3. Run the **Force sync all files** command from the command palette or via the ribbon icon to perform the initial synchronization.

---

## Maintenance

### Database Management

Monitor your Supabase database usage:

1. Navigate to **Database > Dashboard** in your Supabase project.
2. Check storage usage and query performance.
3. Monitor API usage under **Project Settings > Usage**.

---

## Troubleshooting

### Common Issues

1. **Database Initialization Failed**
   - Verify your Supabase API credentials.
   - Check the browser/console for specific error messages.
   - Ensure the SQL setup script ran successfully.

2. **OpenAI API Issues**
   - Confirm your API key is valid.
   - Check for any usage limits or quota issues.
   - Ensure your OpenAI account has sufficient credits.

3. **Sync Errors**
   - Verify your Supabase connection and permissions.
   - Check your file exclusion settings to ensure necessary files are being synced.

### Getting Help

If you encounter any issues:
1. Check the [GitHub Issues](https://github.com/yourusername/mind-matrix/issues) page.
2. Join our Discord community (link available in the repository).
3. Submit a new issue with:
   - Your Obsidian version.
   - Error messages from the console.
   - Steps to reproduce the issue.

---

## Upgrading

1. **Community Plugins:**
   Updates will be delivered automatically via Obsidian's Community Plugins mechanism.

2. **Manual Installations:**
   - Download the new version from GitHub.
   - Replace the files in your plugin directory.
   - Restart Obsidian.
   - Review the changelog for any required database updates or configuration changes.
