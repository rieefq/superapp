type Handler<T> = (payload: T) => void

/** Tiny typed event emitter. */
export function createEmitter<Events extends Record<string, unknown>>() {
  const handlers = new Map<keyof Events, Set<Handler<never>>>()
  return {
    on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler as Handler<never>)
      return () => handlers.get(event)?.delete(handler as Handler<never>)
    },
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      handlers.get(event)?.forEach((h) => (h as Handler<Events[K]>)(payload))
    },
  }
}
