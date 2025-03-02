// src/services/StatusManager.ts
import { Notice } from 'obsidian';

export enum PluginStatus {
	INITIALIZING = 'initializing',
	WAITING_FOR_SYNC = 'waiting_sync',
	CHECKING_FILE = 'checking_file',
	READY = 'ready',
	ERROR = 'error',
	QUEUING = 'queuing', // When tasks are being queued but not processed
	PROCESSING_QUEUE = 'processing_queue' // When working through queued tasks
}

interface StatusDetails {
	message: string;
	timestamp: number;
	error?: Error;
	progress?: number;
	queueSize?: number;
	pendingChanges?: number;
	// New connectivity status indicator for detailed feedback
	connectivityStatus?: 'online' | 'offline' | 'unknown';
	// Last time a successful database check occurred
	lastDatabaseCheck?: number;
}

type StatusChangeCallback = (status: PluginStatus, details: StatusDetails) => void;

export class StatusManager {
	private currentStatus: PluginStatus;
	private statusDetails: StatusDetails;
	private statusBarItem: HTMLElement;
	private subscribers: Set<StatusChangeCallback>;

	constructor(statusBarItem: HTMLElement) {
		this.statusBarItem = statusBarItem;
		this.currentStatus = PluginStatus.INITIALIZING;
		this.statusDetails = {
			message: 'Initializing plugin...',
			timestamp: Date.now(),
			connectivityStatus: 'unknown'
		};
		this.subscribers = new Set();
		this.updateStatusBar();
	}

	/**
	 * Update the current status with new details.
	 */
	public setStatus(status: PluginStatus, details: Partial<StatusDetails> = {}): void {
		const oldStatus = this.currentStatus;
		this.currentStatus = status;
		this.statusDetails = {
			...this.statusDetails,
			...details,
			timestamp: Date.now()
		};
		// Update UI
		this.updateStatusBar();
		// Notify subscribers if status changed
		if (oldStatus !== status) {
			this.notifySubscribers();
		}
		// Display error notice if needed
		if (status === PluginStatus.ERROR && details.message) {
			new Notice(`Mind Matrix: ${details.message}`);
		}
	}

	/**
	 * Get the current status and details.
	 */
	public getStatus(): { status: PluginStatus; details: StatusDetails } {
		return { status: this.currentStatus, details: { ...this.statusDetails } };
	}

	/**
	 * Subscribe to status changes.
	 */
	public subscribe(callback: StatusChangeCallback): () => void {
		this.subscribers.add(callback);
		// Return unsubscribe function
		return () => {
			this.subscribers.delete(callback);
		};
	}

	/**
	 * Update the status bar UI.
	 */
	private updateStatusBar(): void {
		// Clear existing content
		this.statusBarItem.innerHTML = '';
		// Create and append status icon
		const statusIcon = this.createStatusIcon();
		this.statusBarItem.appendChild(statusIcon);
		// Create and append status details text
		const detailsText = document.createElement('span');
		detailsText.addClass('mind-matrix-status-details');
		detailsText.textContent = this.statusDetails.message;
		this.statusBarItem.appendChild(detailsText);

		// Compose tooltip with connectivity and database info if available
		let tooltip = this.statusDetails.message;
		if (this.statusDetails.connectivityStatus) {
			tooltip += ` | Connectivity: ${this.statusDetails.connectivityStatus}`;
		}
		if (this.statusDetails.lastDatabaseCheck) {
			tooltip += ` | Last DB Check: ${new Date(this.statusDetails.lastDatabaseCheck).toLocaleTimeString()}`;
		}
		this.statusBarItem.setAttribute('aria-label', tooltip);
		this.statusBarItem.onclick = () => {
			new Notice(tooltip);
		};
	}

	/**
	 * Create status icon element based on current status.
	 */
	private createStatusIcon(): HTMLElement {
		const icon = document.createElement('span');
		icon.addClass('mind-matrix-status-icon');
		switch (this.currentStatus) {
			case PluginStatus.READY:
				icon.addClass('is-ready');
				icon.innerHTML = '●';
				break;
			case PluginStatus.ERROR:
				icon.addClass('is-error');
				icon.innerHTML = '⚠';
				break;
			case PluginStatus.WAITING_FOR_SYNC:
			case PluginStatus.CHECKING_FILE:
				icon.addClass('is-working');
				icon.innerHTML = '↻';
				break;
			default:
				icon.addClass('is-initializing');
				icon.innerHTML = '○';
		}
		return icon;
	}

	/**
	 * Notify all subscribers of a status change.
	 */
	private notifySubscribers(): void {
		this.subscribers.forEach(callback => {
			try {
				callback(this.currentStatus, this.statusDetails);
			} catch (error) {
				console.error('Error in status change subscriber:', error);
			}
		});
	}

	/**
	 * Check if the plugin is currently in a specific status.
	 */
	public isInStatus(status: PluginStatus): boolean {
		return this.currentStatus === status;
	}

	/**
	 * Update progress for the current task.
	 */
	public updateProgress(progress: number): void {
		this.statusDetails.progress = progress;
		this.updateStatusBar();
	}
}
