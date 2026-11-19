import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PipCorner } from '../settings';
import { CLICK_SLOP, clamp, cornerAt } from './cornerGeometry';
import { CornerGrip } from './CornerGrip';

interface CornerDemoProps {
  /** Corner the player currently snaps to. */
  corner: PipCorner;
  /** Width in percent of the stage width; the aspect keeps the height. */
  width: number;
  /** Live width while the resize grip is dragged. */
  onWidthChange: (width: number) => void;
  /** Persist the corner/size once a gesture ends. */
  onCommit: (corner: PipCorner, width: number) => void;
  /** Promote the demo back to the full stage. */
  onExpand: () => void;
}

interface DragState {
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  /** The player rect and the stage rect when the gesture started. */
  rect: DOMRect;
  stage: DOMRect;
  moved: boolean;
}

const MIN_WIDTH = 15;
const MAX_WIDTH = 55;

/**
 * Interaction layer over the small demo player while the map fills the stage.
 * Click enlarges the demo, dragging snaps it to another corner, and the inner
 * grip resizes it without losing the stage aspect.
 */
export function CornerDemo({ corner, width, onWidthChange, onCommit, onExpand }: CornerDemoProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeWidthRef = useRef(width);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    resizeWidthRef.current = width;
  }, [width]);

  const stageOf = useCallback(
    () => overlayRef.current?.closest<HTMLElement>('.stage') ?? null,
    []
  );

  const clearOffset = useCallback(() => {
    const stage = stageOf();
    if (!stage) return;
    stage.style.removeProperty('--pip-dx');
    stage.style.removeProperty('--pip-dy');
  }, [stageOf]);

  useEffect(() => clearOffset, [clearOffset]);

  // The fullscreen scoreboard starts below a top-right corner window, so it
  // needs the rendered height; the width and stage aspect decide it.
  useEffect(() => {
    const overlay = overlayRef.current;
    const stage = stageOf();
    if (!overlay || !stage) return;
    const publish = () => {
      const height = overlay.getBoundingClientRect().height;
      if (height > 0) stage.style.setProperty('--pip-height-px', `${Math.round(height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(overlay);
    return () => {
      observer.disconnect();
      stage.style.removeProperty('--pip-height-px');
    };
  }, [stageOf]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const overlay = overlayRef.current;
    const stage = stageOf();
    if (!overlay || !stage) return;
    const resize = !!(event.target as Element).closest('.pip-resize');
    dragRef.current = {
      mode: resize ? 'resize' : 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: overlay.getBoundingClientRect(),
      stage: stage.getBoundingClientRect(),
      moved: false
    };
    setDragging(!resize);
    setResizing(resize);
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = stageOf();
    if (!drag || !stage || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > CLICK_SLOP) drag.moved = true;

    if (drag.mode === 'resize') {
      const right = corner === 'top-right' || corner === 'bottom-right';
      const percent = right
        ? ((drag.rect.right - event.clientX) / drag.stage.width) * 100
        : ((event.clientX - drag.rect.left) / drag.stage.width) * 100;
      const next = clamp(Math.round(percent), MIN_WIDTH, MAX_WIDTH);
      resizeWidthRef.current = next;
      onWidthChange(next);
      return;
    }

    if (!drag.moved) return;
    // Keep the player inside the stage while it follows the pointer.
    const offsetX = clamp(dx, drag.stage.left + 4 - drag.rect.left, drag.stage.right - 4 - drag.rect.right);
    const offsetY = clamp(dy, drag.stage.top + 4 - drag.rect.top, drag.stage.bottom - 4 - drag.rect.bottom);
    stage.style.setProperty('--pip-dx', `${Math.round(offsetX)}px`);
    stage.style.setProperty('--pip-dy', `${Math.round(offsetY)}px`);
  };

  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const overlay = overlayRef.current;
    if (!drag || !overlay) return;
    dragRef.current = null;
    setDragging(false);
    setResizing(false);
    try {
      overlay.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer was already released.
    }

    if (drag.mode === 'move') {
      if (!drag.moved) {
        onExpand();
        return;
      }
      const offsetX = clamp(
        event.clientX - drag.startX,
        drag.stage.left + 4 - drag.rect.left,
        drag.stage.right - 4 - drag.rect.right
      );
      const offsetY = clamp(
        event.clientY - drag.startY,
        drag.stage.top + 4 - drag.rect.top,
        drag.stage.bottom - 4 - drag.rect.bottom
      );
      const next = cornerAt(
        drag.rect.left + drag.rect.width / 2 + offsetX,
        drag.rect.top + drag.rect.height / 2 + offsetY,
        drag.stage
      );
      clearOffset();
      onCommit(next, resizeWidthRef.current);
      return;
    }

    // Commit the width the player actually rendered at, so a CSS min-width
    // clamp cannot make the stored value drift from the visible one.
    const stage = stageOf();
    const rendered = stage ? (overlay.getBoundingClientRect().width / stage.getBoundingClientRect().width) * 100 : NaN;
    const next = Number.isFinite(rendered)
      ? clamp(Math.round(rendered), MIN_WIDTH, MAX_WIDTH)
      : resizeWidthRef.current;
    onCommit(corner, next);
  };

  const cancelGesture = () => {
    dragRef.current = null;
    setDragging(false);
    setResizing(false);
    clearOffset();
  };

  return (
    <div
      ref={overlayRef}
      className={
        dragging ? 'pip-overlay is-dragging' : resizing ? 'pip-overlay is-resizing' : 'pip-overlay'
      }
      role="button"
      tabIndex={0}
      aria-label="Demo player: click to enlarge, drag to another corner"
      title="Click to enlarge · drag to a corner · drag the grip to resize"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={cancelGesture}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      <span className="pip-hint">Click to enlarge</span>
      <span className="pip-resize" role="presentation">
        <CornerGrip />
      </span>
    </div>
  );
}
