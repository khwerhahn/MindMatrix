// src/utils/NotificationManager.ts
import { Notice } from 'obsidian';
import { TaskProgress } from '../models/ProcessingTask';

export class NotificationManager {
	private fixedProgressBar: {
		container: HTMLElement;
		fill: HTMLElement;
		text: HTMLElement;
	} | null = null;
	private statusBarItem: HTMLElement;
	private enableNotifications: boolean;
	private enableProgressBar: boolean;
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
		this.initializeStatusBar();
	}

	/**
	 * Shows a notification message.
	 */
	showNotification(message: string, duration: number = 4000): void {
		if (!this.enableNotifications) return;
		// Queue notification to avoid spamming the UI.
		this.notificationQueue.push(message);
		if (!this.isProcessingQueue) {
			this.processNotificationQueue();
		}
	}

	/**
	 * Updates the fixed progress bar with the current progress (in percent) and status message.
	 */
	updateProgress(progress: TaskProgress): void {
		if (!this.enableProgressBar) return;
		// Create the fixed progress bar if it doesn't exist.
		if (!this.fixedProgressBar) {
			this.fixedProgressBar = this.createFixedProgressBar();
		}
		const progressPercentage = Math.round(progress.progress);
		this.fixedProgressBar.fill.style.width = `${progressPercentage}%`;
		// Display the percentage along with a custom status message.
		this.fixedProgressBar.text.textContent = `${progressPercentage}% - ${progress.currentStep} (${progress.currentStepNumber}/${progress.totalSteps})`;
	}

	/**
	 * Initializes the status bar container.
	 */
	private initializeStatusBar(): void {
		// Clear any existing content.
		this.statusBarItem.innerHTML = '';
		// Create a container element (if needed) to host the fixed progress bar.
		const container = document.createElement('div');
		container.addClass('fixed-progress-container');
		this.statusBarItem.appendChild(container);
	}

	/**
	 * Creates a fixed progress bar element.
	 */
	private createFixedProgressBar(): { container: HTMLElement; fill: HTMLElement; text: HTMLElement } {
		const container = document.createElement('div');
		container.addClass('fixed-progress-bar-container');

		const bar = document.createElement('div');
		bar.addClass('fixed-progress-bar');

		const fill = document.createElement('div');
		fill.addClass('fixed-progress-fill');

		const text = document.createElement('div');
		text.addClass('fixed-progress-text');

		bar.appendChild(fill);
		container.appendChild(bar);
		container.appendChild(text);
		this.statusBarItem.appendChild(container);

		return { container, fill, text };
	}

	/**
	 * Processes the notification queue sequentially.
	 */
	private async processNotificationQueue(): Promise<void> {
		if (this.isProcessingQueue || this.notificationQueue.length === 0) return;
		this.isProcessingQueue = true;
		try {
			while (this.notificationQueue.length > 0) {
				const message = this.notificationQueue.shift();
				if (message) {
					new Notice(message);
					// Wait a bit between notifications to avoid spamming.
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
		} finally {
			this.isProcessingQueue = false;
		}
	}

	/**
	 * Updates notification settings.
	 */
	updateSettings(enableNotifications: boolean, enableProgressBar: boolean): void {
		this.enableNotifications = enableNotifications;
		this.enableProgressBar = enableProgressBar;
	}

	/**
	 * Clears all notifications.
	 */
	clear(): void {
		this.notificationQueue = [];
	}
}
