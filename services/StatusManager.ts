// src/services/StatusManager.ts
import { Notice } from 'obsidian';

export enum PluginStatus {
    INITIALIZING = 'initializing',
    WAITING_FOR_SYNC = 'waiting_sync',
    CHECKING_FILE = 'checking_file',
    READY = 'ready',
    ERROR = 'error',
    QUEUING = 'queuing',
    PROCESSING_QUEUE = 'processing_queue',
    PENDING = 'pending',         // New: when an operation is pending
    IN_PROGRESS = 'in_progress', // New: when an operation is actively processing
    COMPLETED = 'completed'      // New: when an operation has finished successfully
}

interface StatusDetails {
    message: string;
    timestamp: number;
    error?: Error;
    progress?: number; // Percentage (0-100)
    queueSize?: number;
    pendingChanges?: number;
    connectivityStatus?: 'online' | 'offline' | 'unknown';
    lastDatabaseCheck?: number;
    // Additional details for operations
    operation?: string;
    step?: string;
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
        this.updateStatusBar();
        if (oldStatus !== status) {
            this.notifySubscribers();
        }
        if (status === PluginStatus.ERROR && details.message) {
            new Notice(`Obsidian RAG: ${details.message}`);
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

        // Create and append the status icon
        const icon = this.createStatusIcon();
        this.statusBarItem.appendChild(icon);

        // Create and append the status details text
        const detailsText = document.createElement('span');
        detailsText.addClass('obsidian-rag-status-details');
        let displayText = this.statusDetails.message;
        if (this.statusDetails.operation) {
            displayText += ` [${this.statusDetails.operation}]`;
        }
        if (this.statusDetails.step) {
            displayText += ` - ${this.statusDetails.step}`;
        }
        if (this.statusDetails.progress !== undefined) {
            displayText += ` (${this.statusDetails.progress}%)`;
        }
        detailsText.textContent = displayText;
        this.statusBarItem.appendChild(detailsText);

        // Compose tooltip with additional details
        let tooltip = this.statusDetails.message;
        if (this.statusDetails.connectivityStatus) {
            tooltip += ` | Connectivity: ${this.statusDetails.connectivityStatus}`;
        }
        if (this.statusDetails.lastDatabaseCheck) {
            tooltip += ` | Last DB Check: ${new Date(this.statusDetails.lastDatabaseCheck).toLocaleTimeString()}`;
        }
        if (this.statusDetails.queueSize !== undefined) {
            tooltip += ` | Queue: ${this.statusDetails.queueSize}`;
        }
        if (this.statusDetails.pendingChanges !== undefined) {
            tooltip += ` | Pending: ${this.statusDetails.pendingChanges}`;
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
        icon.addClass('obsidian-rag-status-icon');
        switch (this.currentStatus) {
            case PluginStatus.READY:
            case PluginStatus.COMPLETED:
                icon.addClass('is-ready');
                icon.innerHTML = '●';
                break;
            case PluginStatus.ERROR:
                icon.addClass('is-error');
                icon.innerHTML = '⚠';
                break;
            case PluginStatus.WAITING_FOR_SYNC:
            case PluginStatus.CHECKING_FILE:
            case PluginStatus.QUEUING:
            case PluginStatus.PROCESSING_QUEUE:
            case PluginStatus.PENDING:
                icon.addClass('is-working');
                icon.innerHTML = '↻';
                break;
            case PluginStatus.IN_PROGRESS:
                icon.addClass('is-in-progress');
                icon.innerHTML = '○';
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
     * Update progress for the current task with detailed step info.
     * @param progress Percentage of completion.
     * @param currentStep Description of the current step.
     * @param operation Optional operation name.
     * @param additionalDetails Optional extra details.
     */
    public updateProgress(progress: number, currentStep: string, operation?: string, additionalDetails?: Partial<StatusDetails>): void {
        this.statusDetails.progress = progress;
        this.statusDetails.step = currentStep;
        if (operation) {
            this.statusDetails.operation = operation;
        }
        if (additionalDetails) {
            this.statusDetails = { ...this.statusDetails, ...additionalDetails };
        }
        this.updateStatusBar();
    }
}
