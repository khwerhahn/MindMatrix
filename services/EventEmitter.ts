// src/services/EventEmitter.ts
import { QueueEventTypes, QueueEventCallback } from '../models/QueueEvents';

export class EventEmitter {
	private listeners: Map<string, Set<Function>> = new Map();

	/**
	 * Emit an event with associated data.
	 * Listeners registered for this event will be called with the data.
	 */
	emit<T extends keyof QueueEventTypes>(event: T, data: QueueEventTypes[T]): void {
		const callbacks = this.listeners.get(event);
		if (callbacks) {
			for (const callback of callbacks) {
				try {
					callback(data);
				} catch (error) {
					console.error(`Error in listener for event "${event}":`, error);
				}
			}
		}
	}

	/**
	 * Register a callback to be invoked when the specified event is emitted.
	 * Returns an unsubscribe function.
	 */
	on<T extends keyof QueueEventTypes>(event: T, callback: QueueEventCallback<T>): () => void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		this.listeners.get(event)?.add(callback);
		// Return an unsubscribe function.
		return () => {
			this.listeners.get(event)?.delete(callback);
		};
	}
}
