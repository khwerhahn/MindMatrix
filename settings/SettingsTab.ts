//SettingsTab.ts
import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import ObsidianRAGPlugin from '../main';
import { ObsidianRAGSettings, generateVaultId, isVaultInitialized, getUserExclusions, SYSTEM_EXCLUSIONS } from './Settings';
import { SupabaseService } from '../services/SupabaseService';

export class ObsidianRAGSettingsTab extends PluginSettingTab {
	plugin: ObsidianRAGPlugin;
	settings: ObsidianRAGSettings;

	constructor(app: App, plugin: ObsidianRAGPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = plugin.settings;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		// Debugging: Log all exclusion settings to console
		console.log("DEBUG - All Exclusion Settings:", {
			userSettings: this.settings.exclusions,
			systemDefaults: SYSTEM_EXCLUSIONS
		});

		// Vault Identification Section
		containerEl.createEl('h2', { text: 'Vault Identification' });

		if (isVaultInitialized(this.settings)) {
			new Setting(containerEl)
				.setName('Vault ID')
				.setDesc('Unique identifier for this vault in the database.')
				.addText(text =>
					text.setValue(this.settings.vaultId!)
						.setDisabled(true)
				);

			new Setting(containerEl)
				.setName('Vault Name')
				.setDesc('The name of your current vault.')
				.addText(text =>
					text.setValue(this.settings.lastKnownVaultName)
						.setDisabled(true)
				);

			new Setting(containerEl)
				.setName('Reset Vault ID')
				.setDesc('Generate a new vault ID (requires full resync).')
				.addButton(btn =>
					btn.setButtonText('Reset')
						.setWarning()
						.onClick(async () => {
							const confirmed = await this.showResetConfirmation();
							if (confirmed) {
								this.settings.vaultId = generateVaultId();
								this.settings.lastKnownVaultName = this.app.vault.getName();
								await this.plugin.saveSettings();
								new Notice('Vault ID has been reset. Please resync your vault.');
								this.display();
							}
						})
				);
		} else {
			new Setting(containerEl)
				.setName('Initialize Vault')
				.setDesc('Generate a unique identifier for this vault to begin syncing.')
				.addButton(btn =>
					btn.setButtonText('Initialize')
						.onClick(async () => {
							this.settings.vaultId = generateVaultId();
							this.settings.lastKnownVaultName = this.app.vault.getName();
							await this.plugin.saveSettings();
							new Notice('Vault has been initialized.');
							this.display();
						})
				);
		}

		// Supabase Settings Section
		containerEl.createEl('h2', { text: 'Supabase Configuration' });
		new Setting(containerEl)
			.setName('Supabase URL')
			.setDesc('The URL of your Supabase project (e.g., https://your-project.supabase.co).')
			.addText(text =>
				text.setPlaceholder('https://your-project.supabase.co')
					.setValue(this.settings.supabase.url)
					.onChange(async (value) => {
						this.settings.supabase.url = value;
						await this.plugin.saveSettings();
						new Notice('Supabase URL updated.');
					})
			);
                new Setting(containerEl)
                        .setName('Supabase API Key')
                        .setDesc('Your Supabase API key (found in your Supabase dashboard).')
                        .addText(text =>
                                text.setPlaceholder('Enter your API key')
                                        .setValue(this.settings.supabase.apiKey)
                                        .onChange(async (value) => {
                                                this.settings.supabase.apiKey = value;
                                                await this.plugin.saveSettings();
                                                new Notice('Supabase API key updated.');
                                        })
                        );

                // Sync Mode Section
                containerEl.createEl('h2', { text: 'Sync Mode' });
const hybridSettingsContainer = containerEl.createDiv('obsidian-rag-hybrid-settings');

new Setting(containerEl)
.setName('Data Sync Mode')
.setDesc('Choose which backend should be updated during sync operations.')
.addDropdown(dropdown =>
dropdown
.addOption('supabase', 'Supabase (Vector)')
.addOption('neo4j', 'Neo4j (Graph)')
.addOption('hybrid', 'Hybrid (Both)')
.setValue(this.settings.sync.mode || 'supabase')
.onChange(async value => {
this.settings.sync.mode = value as 'supabase' | 'neo4j' | 'hybrid';
await this.plugin.saveSettings();
new Notice('Sync mode updated.');
this.updateHybridSettingsVisibility(hybridSettingsContainer);
})
);

new Setting(hybridSettingsContainer)
.setName('Hybrid execution strategy')
.setDesc('Control the order in which vector and graph updates run when hybrid mode is enabled.')
.addDropdown(dropdown =>
dropdown
.addOption('vector-first', 'Vectors first')
.addOption('graph-first', 'Graph first')
.addOption('parallel', 'Run in parallel')
.setValue(this.settings.sync.hybridStrategy.executionOrder)
.onChange(async value => {
this.settings.sync.hybridStrategy.executionOrder = value as 'vector-first' | 'graph-first' | 'parallel';
await this.plugin.saveSettings();
new Notice('Hybrid execution strategy updated.');
})
);

new Setting(hybridSettingsContainer)
.setName('Require dual writes in hybrid mode')
.setDesc('When enabled, syncs will fail if either the vector store or graph database could not be updated.')
.addToggle(toggle =>
toggle
.setValue(this.settings.sync.hybridStrategy.requireDualWrites)
.onChange(async value => {
this.settings.sync.hybridStrategy.requireDualWrites = value;
await this.plugin.saveSettings();
new Notice('Hybrid enforcement preference updated.');
})
);

this.updateHybridSettingsVisibility(hybridSettingsContainer);

                // Neo4j Settings Section
                containerEl.createEl('h2', { text: 'Neo4j Configuration' });
                new Setting(containerEl)
                        .setName('Neo4j URL')
                        .setDesc('Bolt URL to your Neo4j instance (e.g., bolt://localhost:7687).')
                        .addText(text =>
                                text.setPlaceholder('bolt://localhost:7687')
                                        .setValue(this.settings.neo4j.url)
                                        .onChange(async value => {
                                                this.settings.neo4j.url = value;
                                                await this.plugin.saveSettings();
                                                new Notice('Neo4j URL updated.');
                                        })
                        );
                new Setting(containerEl)
                        .setName('Neo4j Username')
                        .setDesc('Database username used for authentication.')
                        .addText(text =>
                                text.setPlaceholder('neo4j')
                                        .setValue(this.settings.neo4j.username)
                                        .onChange(async value => {
                                                this.settings.neo4j.username = value;
                                                await this.plugin.saveSettings();
                                                new Notice('Neo4j username updated.');
                                        })
                        );
                new Setting(containerEl)
                        .setName('Neo4j Password')
                        .setDesc('Password for the provided user account.')
                        .addText(text => {
                                const control = text
                                        .setPlaceholder('password')
                                        .setValue(this.settings.neo4j.password)
                                        .onChange(async value => {
                                                this.settings.neo4j.password = value;
                                                await this.plugin.saveSettings();
                                                new Notice('Neo4j password updated.');
                                        });
                                control.inputEl.type = 'password';
                                return control;
                        });
                new Setting(containerEl)
                        .setName('Neo4j Database')
                        .setDesc('Target database name inside your Neo4j instance.')
                        .addText(text =>
                                text.setPlaceholder('neo4j')
                                        .setValue(this.settings.neo4j.database)
                                        .onChange(async value => {
                                                this.settings.neo4j.database = value;
                                                await this.plugin.saveSettings();
                                                new Notice('Neo4j database updated.');
                                        })
                        );
                new Setting(containerEl)
                        .setName('Project Name')
                        .setDesc('Used to namespace documents inside the graph so multiple vaults can share a database.')
                        .addText(text =>
                                text.setPlaceholder('obsidian-rag')
                                        .setValue(this.settings.neo4j.projectName)
                                        .onChange(async value => {
                                                this.settings.neo4j.projectName = value;
                                                await this.plugin.saveSettings();
                                                new Notice('Neo4j project name updated.');
                                        })
                        );

                // Embedding Provider Settings Section
                containerEl.createEl('h2', { text: 'Embeddings' });

                new Setting(containerEl)
                        .setName('Use Ollama')
                        .setDesc('Prefer a local Ollama server for embeddings before falling back to OpenAI.')
                        .addToggle(toggle =>
                                toggle
                                        .setValue(this.settings.embeddings.ollama.enabled)
                                        .onChange(async (value) => {
                                                this.settings.embeddings.ollama.enabled = value;
                                                await this.plugin.saveSettings();
                                                new Notice(`Ollama embeddings ${value ? 'enabled' : 'disabled'}.`);
                                                this.display();
                                        })
                        );

                new Setting(containerEl)
                        .setName('Ollama URL')
                        .setDesc('Base URL for your Ollama server (e.g., http://localhost:11434).')
                        .addText(text => {
                                const control = text
                                        .setPlaceholder('http://localhost:11434')
                                        .setValue(this.settings.embeddings.ollama.url)
                                        .onChange(async (value) => {
                                                this.settings.embeddings.ollama.url = value.trim();
                                                await this.plugin.saveSettings();
                                                new Notice('Ollama URL updated.');
                                        });
                                control.setDisabled(!this.settings.embeddings.ollama.enabled);
                                return control;
                        });

                new Setting(containerEl)
                        .setName('Ollama Model')
                        .setDesc('Model to request from Ollama (defaults to nomic-embed-text).')
                        .addText(text => {
                                const control = text
                                        .setPlaceholder('nomic-embed-text')
                                        .setValue(this.settings.embeddings.ollama.model)
                                        .onChange(async (value) => {
                                                this.settings.embeddings.ollama.model = value.trim();
                                                await this.plugin.saveSettings();
                                                new Notice('Ollama model updated.');
                                        });
                                control.setDisabled(!this.settings.embeddings.ollama.enabled);
                                return control;
                        });

                new Setting(containerEl)
                        .setName('Fallback to OpenAI')
                        .setDesc('If enabled, OpenAI will be used when Ollama is unavailable or fails.')
                        .addToggle(toggle =>
                                toggle
                                        .setValue(this.settings.embeddings.ollama.fallbackToOpenAI)
                                        .onChange(async (value) => {
                                                this.settings.embeddings.ollama.fallbackToOpenAI = value;
                                                await this.plugin.saveSettings();
                                                new Notice(`OpenAI fallback ${value ? 'enabled' : 'disabled'}.`);
                                        })
                        );

                new Setting(containerEl)
                        .setName('OpenAI API Key')
                        .setDesc('Used when falling back to OpenAI for embeddings.')
                        .addText(text =>
                                text.setPlaceholder('Enter your API key')
                                        .setValue(this.settings.embeddings.openai.apiKey)
                                        .onChange(async (value) => {
                                                this.settings.embeddings.openai.apiKey = value;
                                                if (this.settings.openai) {
                                                        this.settings.openai.apiKey = value;
                                                } else {
                                                        this.settings.openai = { ...this.settings.embeddings.openai };
                                                }
                                                await this.plugin.saveSettings();
                                                new Notice('OpenAI API key updated.');
                                        })
                        );

		// Document Processing Settings Section
		containerEl.createEl('h2', { text: 'Document Processing' });
		new Setting(containerEl)
			.setName('Chunk Size')
			.setDesc('Maximum size of text chunks (in characters).')
			.addText(text =>
				text.setValue(String(this.settings.chunking.chunkSize))
					.onChange(async (value) => {
						const numValue = Number(value);
						if (!isNaN(numValue) && numValue > 0) {
							this.settings.chunking.chunkSize = numValue;
							await this.plugin.saveSettings();
							new Notice('Chunk size updated.');
						}
					})
			);
		new Setting(containerEl)
			.setName('Chunk Overlap')
			.setDesc('Overlap between text chunks (in characters).')
			.addText(text =>
				text.setValue(String(this.settings.chunking.chunkOverlap))
					.onChange(async (value) => {
						const numValue = Number(value);
						if (!isNaN(numValue) && numValue >= 0) {
							this.settings.chunking.chunkOverlap = numValue;
							await this.plugin.saveSettings();
							new Notice('Chunk overlap updated.');
						}
					})
			);

		// Exclusion Settings Section - Only showing user-defined exclusions
		containerEl.createEl('h2', { text: 'Exclusions' });

		// Get only user-defined exclusions for UI display
		const userExclusions = getUserExclusions(this.settings);

		// Debug: Log user exclusions from the function
		console.log("DEBUG - User Exclusions from getUserExclusions():", userExclusions);

		// Filter out any system exclusions that might have been accidentally saved in user lists
		const systemFolders = new Set(SYSTEM_EXCLUSIONS.folders);
		const systemFileTypes = new Set(SYSTEM_EXCLUSIONS.fileTypes);
		const systemFilePrefixes = new Set(SYSTEM_EXCLUSIONS.filePrefixes);
		const systemFiles = new Set(SYSTEM_EXCLUSIONS.files);

		// Debug: Log the system exclusion sets
		console.log("DEBUG - System Exclusion Sets:", {
			folders: Array.from(systemFolders),
			fileTypes: Array.from(systemFileTypes),
			filePrefixes: Array.from(systemFilePrefixes),
			files: Array.from(systemFiles)
		});

		// Filter out system items from user exclusions
		const filteredUserFolders = userExclusions.excludedFolders.filter(folder => !systemFolders.has(folder));
		const filteredUserFileTypes = userExclusions.excludedFileTypes.filter(type => !systemFileTypes.has(type));
		const filteredUserFilePrefixes = userExclusions.excludedFilePrefixes.filter(prefix => !systemFilePrefixes.has(prefix));
		const filteredUserFiles = userExclusions.excludedFiles.filter(file => !systemFiles.has(file));

		// Debug: Log the filtered exclusions
		console.log("DEBUG - Filtered User Exclusions:", {
			folders: filteredUserFolders,
			fileTypes: filteredUserFileTypes,
			filePrefixes: filteredUserFilePrefixes,
			files: filteredUserFiles
		});

		new Setting(containerEl)
			.setName('Excluded Folders')
			.setDesc('Folders to exclude from syncing (comma-separated).')
			.addText(text => {
				const value = filteredUserFolders.join(', ');
				console.log("DEBUG - Setting excluded folders field value:", value);
				return text.setPlaceholder('folder1, folder2')
					.setValue(value)
					.onChange(async (value) => {
						console.log("DEBUG - Folders onChange event value:", value);
						// Save only user-defined folders, ensuring we don't duplicate system folders
						const userFolders = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFolders = userFolders.filter(folder => !systemFolders.has(folder));
						console.log("DEBUG - Final folders to save:", finalFolders);
						this.settings.exclusions.excludedFolders = finalFolders;
						await this.plugin.saveSettings();
						new Notice('Excluded folders updated.');
					});
			});

		new Setting(containerEl)
			.setName('Excluded File Types')
			.setDesc('File extensions to exclude (comma-separated, include the dot).')
			.addText(text => {
				const value = filteredUserFileTypes.join(', ');

				return text.setPlaceholder('.type1, .type2')
					.setValue(value)
					.onChange(async (value) => {
						const userFileTypes = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFileTypes = userFileTypes.filter(type => !systemFileTypes.has(type));
						this.settings.exclusions.excludedFileTypes = finalFileTypes;
						await this.plugin.saveSettings();
						new Notice('Excluded file types updated.');
					});
			});

		new Setting(containerEl)
			.setName('Excluded File Prefixes')
			.setDesc('File name prefixes to exclude (comma-separated).')
			.addText(text => {
				const value = filteredUserFilePrefixes.join(', ');
				console.log("DEBUG - Setting excluded file prefixes field value:", value);
				return text.setPlaceholder('temp, draft')
					.setValue(value)
					.onChange(async (value) => {
						console.log("DEBUG - File prefixes onChange event value:", value);
						// Save only user-defined prefixes, ensuring we don't duplicate system prefixes
						const userFilePrefixes = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFilePrefixes = userFilePrefixes.filter(prefix => !systemFilePrefixes.has(prefix));
						console.log("DEBUG - Final file prefixes to save:", finalFilePrefixes);
						this.settings.exclusions.excludedFilePrefixes = finalFilePrefixes;
						await this.plugin.saveSettings();
						new Notice('Excluded file prefixes updated.');
					});
			});

		new Setting(containerEl)
			.setName('Excluded Files')
			.setDesc('Specific files to exclude from syncing (comma-separated).')
			.addText(text => {
				const value = filteredUserFiles.join(', ');
				console.log("DEBUG - Setting excluded files field value:", value);
				return text.setPlaceholder('file1.md, file2.md')
					.setValue(value)
					.onChange(async (value) => {
						console.log("DEBUG - Files onChange event value:", value);
						// Save only user-defined files, ensuring we don't duplicate system files
						const userFiles = value.split(',').map(s => s.trim()).filter(s => s);
						const finalFiles = userFiles.filter(file => !systemFiles.has(file));
						console.log("DEBUG - Final files to save:", finalFiles);
						this.settings.exclusions.excludedFiles = finalFiles;
						await this.plugin.saveSettings();
						new Notice('Excluded files updated.');
					});
			});

		// Improved info text about system defaults
		const infoDiv = containerEl.createEl('div', { cls: 'setting-item-description' });
		infoDiv.innerHTML = `
			<p><strong>Note:</strong> The following items are automatically excluded by the system:</p>
			<p><strong>Folders:</strong> ${SYSTEM_EXCLUSIONS.folders.join(', ')}</p>
			<p><strong>File Types:</strong> ${SYSTEM_EXCLUSIONS.fileTypes.join(', ')}</p>
			<p><strong>File Prefixes:</strong> ${SYSTEM_EXCLUSIONS.filePrefixes.join(', ')}</p>
			<p><strong>Files:</strong> ${SYSTEM_EXCLUSIONS.files.join(', ')}</p>
		`;

		// Queue & Sync Settings Section
		containerEl.createEl('h2', { text: 'Queue & Sync Settings' });
		new Setting(containerEl)
			.setName('Auto Sync')
			.setDesc('Automatically sync changes to the database when files are modified.')
			.addToggle(toggle =>
				toggle.setValue(this.settings.enableAutoSync)
					.onChange(async (value) => {
						this.settings.enableAutoSync = value;
						await this.plugin.saveSettings();
						new Notice('Auto sync updated.');
					})
			);
		new Setting(containerEl)
			.setName('Sync File Path')
			.setDesc('The path for the dedicated sync file.')
			.addText(text =>
				text.setValue(this.settings.sync.syncFilePath)
					.onChange(async (value) => {
						this.settings.sync.syncFilePath = value;
						// Also update the system excluded files
						const systemFiles = this.settings.exclusions.systemExcludedFiles;
						// Remove old sync file references
						const oldSyncFileIndex = systemFiles.findIndex(f => f === '_obsidianragsync.md');
						const oldSyncBackupIndex = systemFiles.findIndex(f => f === '_obsidianragsync.md.backup');
						if (oldSyncFileIndex !== -1) systemFiles.splice(oldSyncFileIndex, 1);
						if (oldSyncBackupIndex !== -1) systemFiles.splice(oldSyncBackupIndex, 1);
						// Add new sync file references
						systemFiles.push(value);
						systemFiles.push(value + '.backup');
						await this.plugin.saveSettings();
						new Notice('Sync file path updated.');
					})
			);

		// Debug Settings Section
		containerEl.createEl('h2', { text: 'Debug Settings' });
		new Setting(containerEl)
			.setName('Enable Debug Logs')
			.setDesc('Enable detailed debug logs in the console.')
			.addToggle(toggle =>
				toggle.setValue(this.settings.debug.enableDebugLogs)
					.onChange(async (value) => {
						this.settings.debug.enableDebugLogs = value;
						await this.plugin.saveSettings();
						new Notice('Debug logs setting updated.');
					})
			);
		new Setting(containerEl)
			.setName('Log Level')
			.setDesc('Select the level of detail for debug logging.')
			.addDropdown(dropdown =>
				dropdown.addOption('error', 'Error')
					.addOption('warn', 'Warning')
					.addOption('info', 'Info')
					.addOption('debug', 'Debug')
					.setValue(this.settings.debug.logLevel)
					.onChange(async (value) => {
						this.settings.debug.logLevel = value as 'error' | 'warn' | 'info' | 'debug';
						await this.plugin.saveSettings();
						new Notice('Log level updated.');
					})
			);
		new Setting(containerEl)
			.setName('Log to File')
			.setDesc('Save debug logs to a file in your vault.')
			.addToggle(toggle =>
				toggle.setValue(this.settings.debug.logToFile)
					.onChange(async (value) => {
						this.settings.debug.logToFile = value;
						await this.plugin.saveSettings();
						new Notice('Log to file setting updated.');
					})
			);

		// Database Management Section
		containerEl.createEl('h2', { text: 'Database Management' });

		// Database Status
		const statusContainer = containerEl.createDiv('database-status-container');
		const statusText = statusContainer.createEl('p', { text: 'Checking database status...' });
		
		// Test Connection Button
		const testButton = containerEl.createEl('button', { text: 'Test Database Connection' });
		testButton.onClickEvent(async () => {
			testButton.setAttr('disabled', 'true');
			statusText.setText('Testing connection...');
			
			try {
				const supabase = await SupabaseService.getInstance(this.plugin.settings);
				if (!supabase) {
					statusText.setText('❌ Database connection failed: Invalid credentials');
					return;
				}

				const setupStatus = await supabase.checkDatabaseSetup();
				if (setupStatus.isComplete) {
					statusText.setText('✅ Database connection successful and all tables are set up correctly');
				} else {
					let message = '⚠️ Database setup incomplete:';
					if (setupStatus.missingTables.length > 0) {
						message += `\nMissing tables: ${setupStatus.missingTables.join(', ')}`;
					}
					if (setupStatus.error) {
						message += `\nError: ${setupStatus.error}`;
					}
					statusText.setText(message);
				}
			} catch (error) {
				statusText.setText(`❌ Database connection failed: ${(error as Error).message}`);
			} finally {
				testButton.removeAttribute('disabled');
			}
		});

		// Reset Database Button
		const resetButton = containerEl.createEl('button', { 
			text: 'Reset Database',
			cls: 'mod-warning'
		});
		resetButton.onClickEvent(async () => {
			const confirmed = await new Promise<boolean>((resolve) => {
				const notice = new Notice('This will delete all data in the database. Are you sure?');
				notice.setMessage('This will delete all data in the database. Are you sure?', [
					{
						text: 'Yes',
						callback: () => {
							notice.hide();
							resolve(true);
						}
					},
					{
						text: 'No',
						callback: () => {
							notice.hide();
							resolve(false);
						}
					}
				]);
			});

			if (!confirmed) return;

			resetButton.setAttr('disabled', 'true');
			statusText.setText('Resetting database...');

			try {
				const supabase = await SupabaseService.getInstance(this.plugin.settings);
				if (!supabase) {
					statusText.setText('❌ Database reset failed: Invalid credentials');
					return;
				}

				const result = await supabase.resetDatabase();
				if (result.success) {
					statusText.setText('✅ Database reset successfully');
				} else {
					statusText.setText(`❌ Database reset failed: ${result.message}`);
				}
			} catch (error) {
				statusText.setText(`❌ Database reset failed: ${(error as Error).message}`);
			} finally {
				resetButton.removeAttribute('disabled');
			}
		});
	}

	private async showResetConfirmation(): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = this.app.modal;
			modal.open((modal) => {
				modal.titleEl.setText('Reset Vault ID');
				modal.contentEl.setText(
					'Warning: Resetting the vault ID will disconnect this vault from its existing database entries. This operation cannot be undone. Are you sure you want to continue?'
				);
				modal.addButton((btn) => {
					btn.setButtonText('Cancel').onClick(() => {
						resolve(false);
						modal.close();
					});
				});
				modal.addButton((btn) => {
					btn.setButtonText('Reset').setWarning().onClick(() => {
						resolve(true);
						modal.close();
					});
				});
			});
		});
	}

		private updateHybridSettingsVisibility(container: HTMLElement): void {
			if (!container) return;
			if (this.settings.sync.mode === 'hybrid') {
				container.removeClass('is-hidden');
			} else {
				container.addClass('is-hidden');
			}
		}
}
