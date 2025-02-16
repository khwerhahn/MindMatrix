import { Plugin, TAbstractFile } from 'obsidian';
import { StatusManager, PluginStatus } from './StatusManager';

export class SyncDetectionManager {
    private lastSyncActivity: number = 0;
    private syncCheckInterval: NodeJS.Timeout | null = null;
    private quietPeriodReached: boolean = false;
    private isWaitingForQuietPeriod: boolean = false;
    private readonly QUIET_PERIOD_MS = 5000; // 5 seconds

    constructor(
        private plugin: Plugin,
        private statusManager: StatusManager,
        private onQuietPeriodReached: () => void
    ) {}

    /**
     * Start monitoring for sync activity
     */
    public startMonitoring(): void {
        // Track file changes as potential sync activity
        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', () => this.recordSyncActivity())
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('create', () => this.recordSyncActivity())
        );
        this.plugin.registerEvent(
            this.plugin.app.vault.on('delete', () => this.recordSyncActivity())
        );

        // Start checking for quiet period
        this.startQuietPeriodCheck();
    }

    /**
     * Record sync activity and reset quiet period
     */
    private recordSyncActivity(): void {
        this.lastSyncActivity = Date.now();
        this.quietPeriodReached = false;

        if (this.isWaitingForQuietPeriod) {
            this.statusManager.setStatus(PluginStatus.WAITING_FOR_SYNC, {
                message: 'Waiting for Obsidian sync to settle...'
            });
        }
    }

    /**
     * Start checking for quiet period
     */
    private startQuietPeriodCheck(): void {
        if (this.syncCheckInterval) {
            clearInterval(this.syncCheckInterval);
        }

        this.isWaitingForQuietPeriod = true;
        this.syncCheckInterval = setInterval(() => {
            const timeSinceLastSync = Date.now() - this.lastSyncActivity;

            if (timeSinceLastSync >= this.QUIET_PERIOD_MS && !this.quietPeriodReached) {
                this.quietPeriodReached = true;
                this.isWaitingForQuietPeriod = false;

                if (this.syncCheckInterval) {
                    clearInterval(this.syncCheckInterval);
                    this.syncCheckInterval = null;
                }

                this.onQuietPeriodReached();
            }
        }, 1000); // Check every second
    }

    /**
     * Stop monitoring for sync activity
     */
    public stopMonitoring(): void {
        if (this.syncCheckInterval) {
            clearInterval(this.syncCheckInterval);
            this.syncCheckInterval = null;
        }
        this.isWaitingForQuietPeriod = false;
    }

    /**
     * Check if currently waiting for quiet period
     */
    public isWaiting(): boolean {
        return this.isWaitingForQuietPeriod;
    }

    /**
     * Get time since last sync activity
     */
    public getTimeSinceLastSync(): number {
        return Date.now() - this.lastSyncActivity;
    }
}
