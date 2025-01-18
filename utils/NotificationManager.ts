import { Notice } from 'obsidian';
import { TaskProgress } from '../models/ProcessingTask';

interface ProgressBar {
    container: HTMLElement;
    fill: HTMLElement;
    text: HTMLElement;
    lastUpdate: number;
}

export class NotificationManager {
    private progressBars: Map<string, ProgressBar> = new Map();
    private statusBarItem: HTMLElement;
    private readonly enableNotifications: boolean;
    private readonly enableProgressBar: boolean;
    private notificationQueue: string[] = [];
    private isProcessingQueue: boolean = false;

    constructor(
        statusBarEl: HTMLElement,
        enableNotifications: boolean,
        enableProgressBar: boolean
    ) {
        this.statusBarItem = statusBarEl;
        this.enableNotifications = enableNotifications;
        this.enableProgressBar = enableProgressBar;

        // Create status bar container
        this.initializeStatusBar();
    }

    /**
     * Shows a notification message
     */
    showNotification(message: string, duration: number = 4000): void {
        if (!this.enableNotifications) return;

        // Queue notification
        this.notificationQueue.push(message);
        if (!this.isProcessingQueue) {
            this.processNotificationQueue();
        }
    }

    /**
     * Updates progress for a task
     */
    updateProgress(progress: TaskProgress): void {
        if (!this.enableProgressBar) return;

        const progressBarId = `progress-${progress.taskId}`;

        // Calculate total progress percentage
        const progressPercentage = Math.round(progress.progress);

        // Update or create progress bar
        this.updateProgressBar(progressBarId, {
            progress: progressPercentage,
            message: this.formatProgressMessage(progress),
            total: progress.totalSteps,
            current: progress.currentStepNumber
        });

        // Show additional details if available
        if (progress.details) {
            const details = this.formatProgressDetails(progress.details);
            if (details) {
                this.showNotification(details, 2000);
            }
        }

        // Remove completed progress bars
        if (progressPercentage >= 100) {
            setTimeout(() => {
                this.removeProgressBar(progressBarId);
            }, 2000);
        }
    }

    /**
     * Initializes the status bar
     */
    private initializeStatusBar(): void {
        const container = document.createElement('div');
        container.addClass('mind-matrix-status');
        this.statusBarItem.appendChild(container);
    }

    /**
     * Updates or creates a progress bar
     */
    private updateProgressBar(id: string, options: {
        progress: number;
        message: string;
        total: number;
        current: number;
    }): void {
        let progressBar = this.progressBars.get(id);

        if (!progressBar) {
            progressBar = this.createProgressBar(id);
            this.progressBars.set(id, progressBar);
        }

        // Update progress bar elements
        progressBar.fill.style.width = `${options.progress}%`;
        progressBar.text.textContent = this.formatProgressMessage({
            taskId: id,
            progress: options.progress,
            currentStep: options.message,
            totalSteps: options.total,
            currentStepNumber: options.current
        });

        progressBar.lastUpdate = Date.now();
    }

    /**
     * Creates a new progress bar
     */
    private createProgressBar(id: string): ProgressBar {
        const container = document.createElement('div');
        container.addClass('progress-container');
        container.setAttribute('data-id', id);

        const bar = document.createElement('div');
        bar.addClass('progress-bar');

        const fill = document.createElement('div');
        fill.addClass('progress-fill');

        const text = document.createElement('div');
        text.addClass('progress-text');

        bar.appendChild(fill);
        container.appendChild(bar);
        container.appendChild(text);
        this.statusBarItem.appendChild(container);

        return {
            container,
            fill,
            text,
            lastUpdate: Date.now()
        };
    }

    /**
     * Removes a progress bar
     */
    private removeProgressBar(id: string): void {
        const progressBar = this.progressBars.get(id);
        if (progressBar) {
            progressBar.container.remove();
            this.progressBars.delete(id);
        }
    }

    /**
     * Formats progress message
     */
    private formatProgressMessage(progress: TaskProgress): string {
        return `${progress.currentStep} (${progress.currentStepNumber}/${progress.totalSteps})`;
    }

    /**
     * Formats progress details
     */
    private formatProgressDetails(details: TaskProgress['details']): string | null {
        if (!details) return null;

        const parts = [];
        if (details.processedChunks !== undefined) {
            parts.push(`Chunks: ${details.processedChunks}/${details.totalChunks}`);
        }
        if (details.processedTokens !== undefined) {
            parts.push(`Tokens: ${details.processedTokens}/${details.totalTokens}`);
        }
        return parts.join(' | ');
    }

    /**
     * Processes notification queue
     */
    private async processNotificationQueue(): Promise<void> {
        if (this.isProcessingQueue || this.notificationQueue.length === 0) return;

        this.isProcessingQueue = true;

        try {
            while (this.notificationQueue.length > 0) {
                const message = this.notificationQueue.shift();
                if (message) {
                    new Notice(message);
                    // Wait a bit between notifications
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * Updates notification settings
     */
    updateSettings(enableNotifications: boolean, enableProgressBar: boolean): void {
        this.enableNotifications = enableNotifications;
        this.enableProgressBar = enableProgressBar;

        // Clear progress bars if disabled
        if (!enableProgressBar) {
            for (const [id] of this.progressBars) {
                this.removeProgressBar(id);
            }
        }
    }

    /**
     * Clears all progress bars
     */
    clear(): void {
        for (const [id] of this.progressBars) {
            this.removeProgressBar(id);
        }
        this.notificationQueue = [];
    }
}
