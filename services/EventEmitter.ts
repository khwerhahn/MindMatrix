// src/services/EventEmitter.ts
import { QueueEventTypes, QueueEventCallback } from '../models/QueueEvents';

export class EventEmitter {
    private listeners: Map<string, Set<Function>> = new Map();

    emit<T extends keyof QueueEventTypes>(
        event: T,
        data: QueueEventTypes[T]
    ): void {
        const callbacks = this.listeners.get(event);
        callbacks?.forEach(callback => callback(data));
    }

    on<T extends keyof QueueEventTypes>(
        event: T,
        callback: QueueEventCallback<T>
    ): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)?.add(callback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }
}
