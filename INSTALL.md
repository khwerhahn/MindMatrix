# Installation Guide

## Prerequisites
Before installing Mind Matrix, ensure you have:
1. Latest Obsidian version
2. Supabase account and project
3. OpenAI API key for embeddings generation

## Installation Steps

### 1. Install the Plugin
#### From Obsidian Community Plugins
1. Open Obsidian Settings
2. Go to Community Plugins
3. Search for "Mind Matrix"
4. Click Install, then Enable

#### Manual Installation
1. Download the latest release from the GitHub releases page
2. Extract the files to your vault's plugins directory: `.obsidian/plugins/mind-matrix/`
3. Restart Obsidian
4. Enable the plugin in Community Plugins settings

### 2. Set Up Supabase

1. Create a new Supabase project:
   - Go to [Supabase](https://supabase.com)
   - Sign in and click "New Project"
   - Fill in project details and create the project

2. Set up the database schema:
   - Go to your Supabase project dashboard
   - Click on "SQL Editor" in the left sidebar
   - Create a "New Query"
   - Copy and paste the SQL setup script from sql/setup.sql [sql/setup.sql](./sql/setup.sql)
   - Execute the script

3. Get your API credentials:
   - Go to Project Settings > API
   - Copy the Project URL and service_role API key
   - Keep these credentials secure; you'll need them for the plugin configuration

### 3. Get OpenAI API Key
1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key (you'll need it for plugin configuration)

### 4. Configure the Plugin
1. Open Obsidian Settings
2. Go to Mind Matrix settings
3. Enter your API credentials:
   - Supabase URL (Project URL)
   - Supabase API Key (service_role key)
   - OpenAI API Key
4. Configure exclusion patterns (optional):
   - Excluded folders (e.g., .obsidian, node_modules)
   - Excluded file types (e.g., .mp3, .jpg, .png)
   - Excluded file prefixes (e.g., _, .)

### 5. Initial Setup
1. Initialize the vault (this generates a unique identifier)
2. Enable auto-sync if desired
3. Use the "Force sync all files" command for initial synchronization

## Maintenance

### Database Management
Monitor your database usage in Supabase:
1. Go to Database > Dashboard
2. Check storage usage and query performance
3. Monitor API usage in Project Settings > Usage

## Troubleshooting

### Common Issues
1. Database Initialization Failed
   - Verify Supabase API credentials
   - Check console for specific error messages
   - Ensure SQL setup was run successfully
2. OpenAI API Issues
   - Verify API key is valid
   - Check usage limits
   - Ensure sufficient credits
3. Sync Errors
   - Check Supabase connection
   - Verify permissions
   - Check file exclusion settings

### Getting Help
If you encounter issues:
1. Check GitHub Issues
2. Join our Discord community
3. Submit a new issue with:
   - Obsidian version
   - Error messages from console
   - Steps to reproduce

### Upgrading
1. Community plugins update automatically
2. For manual installations:
   - Download the new version
   - Replace files in the plugin directory
   - Restart Obsidian
3. Check the changelog for any required database updates
