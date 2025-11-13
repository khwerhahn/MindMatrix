# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of Obsidian RAG plugin
- Database management features
  - Automated database setup
  - Connection testing
  - Database reset functionality
- Core services implementation
  - SupabaseService for database operations
  - SettingsService for configuration management
- Development environment setup
  - Makefile for common operations
  - SQL scripts for database setup
  - Environment configuration

### Changed
- Improved error handling in database operations
- Enhanced logging throughout the application
- Updated documentation structure

### Fixed
- Database connection issues
- Environment variable handling
- Build process optimizations
- Front matter tag parsing now splits comma-separated values into individual tags

## [0.1.0] - 2024-04-13

### Added
- Initial project setup
- Basic plugin structure
- Development environment configuration 