// src/models/SyncModels.ts

/**
 * Defines the structure and types for sync file coordination
 */

/**
 * Represents a device known by the sync system
 */
export interface SyncDevice {
    deviceId: string;         // Unique identifier for this device
    name: string;             // User-friendly device name
    platform: string;         // Operating system/platform
    lastSeen: number;         // Timestamp when device was last active
    lastSyncTime: number;     // Last successful database sync timestamp
    obsidianVersion?: string; // Obsidian version (optional)
    pluginVersion?: string;   // Plugin version (optional)
}

/**
 * Represents the overall sync state
 */
export enum SyncState {
    UNKNOWN = 'unknown',
    INITIALIZING = 'initializing',
    ONLINE = 'online',
    OFFLINE = 'offline',
    ERROR = 'error',
    CONFLICT = 'conflict'
}

/**
 * Represents a connection event
 */
export interface ConnectionEvent {
    timestamp: number;
    eventType: 'connected' | 'disconnected';
    deviceId: string;
    details?: string;
}

/**
 * Represents a sync operation performed during offline mode
 */
export interface PendingOperation {
    id: string;               // Unique operation ID
    fileId: string;           // File path this operation affects
    operationType: 'create' | 'update' | 'delete' | 'rename';
    timestamp: number;        // When the operation occurred
    deviceId: string;         // Device that performed the operation
    metadata?: {              // Additional operation data
        oldPath?: string;     // For rename operations
        contentHash?: string; // For create/update operations
        lastModified?: number; // Last modified timestamp
    };
    status: 'pending' | 'processing' | 'error';
    errorDetails?: string;    // Error information if status is 'error'
}

/**
 * Represents a detected conflict between devices
 */
export interface SyncConflict {
    id: string;                    // Unique conflict ID
    fileId: string;                // File path with conflict
    detectedAt: number;            // When conflict was detected
    devices: string[];             // Device IDs involved in conflict
    resolutionStatus: 'pending' | 'resolved';
    resolutionStrategy?: 'newest-wins' | 'manual' | 'keep-both';
    resolvedAt?: number;           // When conflict was resolved
    resolvedBy?: string;           // Device ID that resolved the conflict
}

/**
 * Represents the structure of the sync file YAML header
 */
export interface SyncFileHeader {
    lastGlobalSync: number;             // Last time any device synced successfully
    syncState: SyncState;               // Current sync state
    vaultId: string;                    // Vault identifier
    pluginVersion: string;              // Plugin version that last wrote this file
    lastWriter: string;                 // Device ID that last wrote this file
    devices: Record<string, SyncDevice>; // Map of device IDs to device info
}

/**
 * Represents the full structure of the sync file
 * This will be serialized to/from YAML
 */
export interface SyncFileData {
    header: SyncFileHeader;
    connectionEvents: ConnectionEvent[];   // Recent connection state changes
    pendingOperations: PendingOperation[]; // Operations queued during offline mode
    conflicts: SyncConflict[];            // Detected sync conflicts
    lastDatabaseCheck: number;            // Last time database connectivity was checked
    databaseStatus: 'available' | 'unavailable' | 'unknown';
}

/**
 * Represents the validation status of the sync file
 */
export interface SyncValidationResult {
    isValid: boolean;
    error?: string;
    details?: Record<string, any>;
}

/**
 * Error types specific to sync operations
 */
export enum SyncErrorType {
    SYNC_FILE_MISSING = 'sync_file_missing',
    SYNC_FILE_CORRUPT = 'sync_file_corrupt',
    SYNC_FILE_OUTDATED = 'sync_file_outdated',
    DEVICE_MISMATCH = 'device_mismatch',
    CONFLICT_DETECTED = 'conflict_detected',
    DATABASE_UNAVAILABLE = 'database_unavailable',
    SYNC_INTERRUPTED = 'sync_interrupted',
    UNKNOWN_ERROR = 'unknown_error'
}

/**
 * Default maximum items to keep in each history list
 */
export const MAX_CONNECTION_EVENTS = 20;
export const MAX_PENDING_OPERATIONS = 100;
export const MAX_CONFLICTS = 50;

/**
 * Helper function to get platform information
 */
export function getPlatformInfo(): string {
    const userAgent = window.navigator.userAgent;

    if (userAgent.indexOf('Win') !== -1) return 'Windows';
    if (userAgent.indexOf('Mac') !== -1) return 'macOS';
    if (userAgent.indexOf('iPhone') !== -1 || userAgent.indexOf('iPad') !== -1) return 'iOS';
    if (userAgent.indexOf('Android') !== -1) return 'Android';
    if (userAgent.indexOf('Linux') !== -1) return 'Linux';

    return 'Unknown';
}

/**
 * Creates a new empty sync file data structure
 */
export function createEmptySyncFileData(
    vaultId: string,
    deviceId: string,
    deviceName: string,
    pluginVersion: string
): SyncFileData {
    const now = Date.now();
    const platform = getPlatformInfo();

    const device: SyncDevice = {
        deviceId,
        name: deviceName,
        platform,
        lastSeen: now,
        lastSyncTime: now
    };

    const devices: Record<string, SyncDevice> = {};
    devices[deviceId] = device;

    return {
        header: {
            lastGlobalSync: now,
            syncState: SyncState.INITIALIZING,
            vaultId,
            pluginVersion,
            lastWriter: deviceId,
            devices
        },
        connectionEvents: [],
        pendingOperations: [],
        conflicts: [],
        lastDatabaseCheck: now,
        databaseStatus: 'unknown'
    };
}

/**
 * Trims history arrays to keep them at a reasonable size
 */
export function trimSyncHistoryArrays(data: SyncFileData): SyncFileData {
    return {
        ...data,
        connectionEvents: data.connectionEvents.slice(-MAX_CONNECTION_EVENTS),
        pendingOperations: data.pendingOperations.slice(-MAX_PENDING_OPERATIONS),
        conflicts: data.conflicts.slice(-MAX_CONFLICTS)
    };
}

/**
 * Updates device information in the sync file
 */
export function updateDeviceInSyncFile(
    data: SyncFileData,
    deviceId: string,
    deviceName: string,
    pluginVersion?: string
): SyncFileData {
    const now = Date.now();
    const platform = getPlatformInfo();

    // Deep clone the data to avoid mutations
    const newData = JSON.parse(JSON.stringify(data)) as SyncFileData;

    if (!newData.header.devices) {
        newData.header.devices = {};
    }

    // Update or create device entry
    if (newData.header.devices[deviceId]) {
        newData.header.devices[deviceId] = {
            ...newData.header.devices[deviceId],
            name: deviceName,
            platform,
            lastSeen: now,
            pluginVersion: pluginVersion || newData.header.devices[deviceId].pluginVersion
        };
    } else {
        newData.header.devices[deviceId] = {
            deviceId,
            name: deviceName,
            platform,
            lastSeen: now,
            lastSyncTime: now,
            pluginVersion
        };
    }

    newData.header.lastWriter = deviceId;
    if (pluginVersion) {
        newData.header.pluginVersion = pluginVersion;
    }

    return newData;
}

/**
 * Adds a connection event to the sync file
 */
export function addConnectionEvent(
    data: SyncFileData,
    eventType: 'connected' | 'disconnected',
    deviceId: string,
    details?: string
): SyncFileData {
    const newData = JSON.parse(JSON.stringify(data)) as SyncFileData;

    newData.connectionEvents.push({
        timestamp: Date.now(),
        eventType,
        deviceId,
        details
    });

    // Keep array size manageable
    if (newData.connectionEvents.length > MAX_CONNECTION_EVENTS) {
        newData.connectionEvents = newData.connectionEvents.slice(-MAX_CONNECTION_EVENTS);
    }

    return newData;
}

/**
 * Adds a pending operation to the sync file
 */
export function addPendingOperation(
    data: SyncFileData,
    fileId: string,
    operationType: 'create' | 'update' | 'delete' | 'rename',
    deviceId: string,
    metadata?: {
        oldPath?: string;
        contentHash?: string;
        lastModified?: number;
    }
): SyncFileData {
    const newData = JSON.parse(JSON.stringify(data)) as SyncFileData;

    newData.pendingOperations.push({
        id: crypto.randomUUID(),
        fileId,
        operationType,
        timestamp: Date.now(),
        deviceId,
        metadata,
        status: 'pending'
    });

    // Keep array size manageable
    if (newData.pendingOperations.length > MAX_PENDING_OPERATIONS) {
        newData.pendingOperations = newData.pendingOperations.slice(-MAX_PENDING_OPERATIONS);
    }

    return newData;
}

/**
 * Adds a sync conflict to the sync file
 */
export function addSyncConflict(
    data: SyncFileData,
    fileId: string,
    devices: string[]
): SyncFileData {
    const newData = JSON.parse(JSON.stringify(data)) as SyncFileData;

    newData.conflicts.push({
        id: crypto.randomUUID(),
        fileId,
        detectedAt: Date.now(),
        devices,
        resolutionStatus: 'pending'
    });

    // Keep array size manageable
    if (newData.conflicts.length > MAX_CONFLICTS) {
        newData.conflicts = newData.conflicts.slice(-MAX_CONFLICTS);
    }

    // Update sync state to indicate conflict
    newData.header.syncState = SyncState.CONFLICT;

    return newData;
}

/**
 * Updates the database status in the sync file
 */
export function updateDatabaseStatus(
    data: SyncFileData,
    status: 'available' | 'unavailable' | 'unknown'
): SyncFileData {
    const newData = JSON.parse(JSON.stringify(data)) as SyncFileData;

    newData.databaseStatus = status;
    newData.lastDatabaseCheck = Date.now();

    // Update sync state based on database status
    if (status === 'unavailable') {
        newData.header.syncState = SyncState.OFFLINE;
    } else if (status === 'available') {
        newData.header.syncState = SyncState.ONLINE;
    }

    return newData;
}

/**
 * Updates the last sync time for a device
 */
export function updateDeviceSyncTime(
    data: SyncFileData,
    deviceId: string
): SyncFileData {
    const newData = JSON.parse(JSON.stringify(data)) as SyncFileData;
    const now = Date.now();

    if (newData.header.devices && newData.header.devices[deviceId]) {
        newData.header.devices[deviceId].lastSyncTime = now;
        newData.header.devices[deviceId].lastSeen = now;
        newData.header.lastGlobalSync = now;
    }

    return newData;
}
