import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export type MduiEventHandler<TEvent extends Event = Event> = (
  event: TEvent
) => void;

/**
 * Subscribes to a custom-element event without relying on React's synthetic
 * event map. The stable native listener and exact cleanup make the hook safe
 * when React StrictMode replays effects in development.
 */
export function useMduiEvent<
  TTarget extends EventTarget,
  TEvent extends Event = Event
>(
  targetRef: RefObject<TTarget | null>,
  type: string,
  handler: MduiEventHandler<TEvent> | undefined,
  options?: boolean | AddEventListenerOptions
): void {
  const handlerRef = useRef(handler);

  // Refresh the callback before the browser can deliver an event for the new
  // commit. A passive effect leaves a frame where the stable native listener
  // can still call the previous render's closure.
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const listener: EventListener = (event) => {
      handlerRef.current?.(event as TEvent);
    };

    target.addEventListener(type, listener, options);
    return () => {
      target.removeEventListener(type, listener, options);
    };
  }, [options, targetRef, type]);
}
