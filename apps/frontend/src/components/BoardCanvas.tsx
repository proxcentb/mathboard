import { useEffect, useRef, useState } from "react";
import styles from "./BoardCanvas.module.css";
import {
  BoardImage,
  BoardOperation,
  CanvasSnapshot,
  DrawingTool,
  Point,
  RemoteCursor,
  RemoteStroke,
  Stroke
} from "../types";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const GRID_SIZE = 24;
const HANDLE_SIZE = 18;

interface BoardCanvasProps {
  canvas: CanvasSnapshot;
  tool: DrawingTool;
  color: string;
  size: number;
  cursors: RemoteCursor[];
  remoteStrokes: RemoteStroke[];
  onOperation: (operation: BoardOperation) => void;
  onCursorMove: (canvasId: string, point: Point) => void;
  onCursorLeave: () => void;
  onStrokePreview: (canvasId: string, stroke: Stroke) => void;
  onStrokeEnd: (canvasId: string, strokeId: string) => void;
}

interface DragState {
  mode: "move" | "resize";
  imageId: string;
  start: Point;
  before: BoardImage;
  latest: BoardImage;
}

export function BoardCanvas({
  canvas,
  tool,
  color,
  size,
  cursors,
  remoteStrokes,
  onOperation,
  onCursorMove,
  onCursorLeave,
  onStrokePreview,
  onStrokeEnd
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const draftStrokeRef = useRef<Stroke | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointerPointRef = useRef<Point | null>(null);
  const liveStrokeTimeoutRef = useRef<number | null>(null);
  const lastLiveStrokeAtRef = useRef(0);
  const pendingLiveStrokeRef = useRef<Stroke | null>(null);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const [draftImage, setDraftImage] = useState<BoardImage | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [eraserPoint, setEraserPoint] = useState<Point | null>(null);
  const [lineStart, setLineStart] = useState<Point | null>(null);
  const [linePreviewPoint, setLinePreviewPoint] = useState<Point | null>(null);
  const [isCtrlLineActive, setIsCtrlLineActive] = useState(false);

  useEffect(() => {
    return () => {
      const stroke = draftStrokeRef.current;
      if (stroke) {
        onStrokeEnd(canvas.id, stroke.id);
      }

      if (liveStrokeTimeoutRef.current) {
        window.clearTimeout(liveStrokeTimeoutRef.current);
      }

      onCursorLeave();
    };
  }, [canvas.id, onCursorLeave, onStrokeEnd]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Control" ||
        event.repeat ||
        tool !== "pen" ||
        draftStrokeRef.current ||
        dragRef.current
      ) {
        return;
      }

      const point = pointerPointRef.current;
      if (!point) {
        return;
      }

      setIsCtrlLineActive(true);
      setLineStart(point);
      setLinePreviewPoint(point);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Control") {
        return;
      }

      setIsCtrlLineActive(false);
      setLineStart(null);
      setLinePreviewPoint(null);
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("keyup", handleKeyUp, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [tool]);

  useEffect(() => {
    resizeCanvasForDisplay(canvasRef.current);
    drawCanvas(
      canvasRef.current,
      canvas,
      imageCacheRef.current,
      draftStroke,
      draftImage,
      selectedImageId,
      tool === "eraser" ? eraserPoint : null,
      size,
      lineStart && linePreviewPoint ? createLineStroke(lineStart, linePreviewPoint, color, size) : null,
      cursors,
      remoteStrokes
    );
  }, [
    canvas,
    color,
    cursors,
    draftImage,
    draftStroke,
    eraserPoint,
    linePreviewPoint,
    lineStart,
    selectedImageId,
    size,
    tool,
    remoteStrokes
  ]);

  function scheduleStrokePreview(stroke: Stroke) {
    pendingLiveStrokeRef.current = stroke;
    const now = window.performance.now();
    const elapsed = now - lastLiveStrokeAtRef.current;

    if (elapsed >= 100) {
      flushStrokePreview();
      return;
    }

    if (liveStrokeTimeoutRef.current) {
      return;
    }

    liveStrokeTimeoutRef.current = window.setTimeout(flushStrokePreview, 100 - elapsed);
  }

  function flushStrokePreview() {
    if (liveStrokeTimeoutRef.current) {
      window.clearTimeout(liveStrokeTimeoutRef.current);
      liveStrokeTimeoutRef.current = null;
    }

    const stroke = pendingLiveStrokeRef.current;
    if (!stroke) {
      return;
    }

    pendingLiveStrokeRef.current = null;
    lastLiveStrokeAtRef.current = window.performance.now();
    onStrokePreview(canvas.id, stroke);
  }

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    pointerPointRef.current = point;
    onCursorMove(canvas.id, point);
    const hit = event.altKey ? findImageHit(canvas.images, point) : null;

    if (tool === "pen" && lineStart && isCtrlLineActive) {
      onOperation({
        type: "stroke:add",
        canvasId: canvas.id,
        stroke: createLineStroke(lineStart, point, color, size)
      });
      setLineStart(null);
      setLinePreviewPoint(null);
      setIsCtrlLineActive(false);
      setSelectedImageId(null);
      return;
    }

    if (tool === "pen") {
      setLineStart(null);
      setLinePreviewPoint(null);
      setIsCtrlLineActive(false);
    }

    if (hit) {
      const mode = isResizeHandle(hit, point) ? "resize" : "move";
      const drag: DragState = {
        mode,
        imageId: hit.id,
        start: point,
        before: hit,
        latest: hit
      };
      dragRef.current = drag;
      setSelectedImageId(hit.id);
      setDraftImage(hit);
      return;
    }

    setEraserPoint(tool === "eraser" ? point : null);
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      tool,
      color,
      size,
      points: [point]
    };
    draftStrokeRef.current = stroke;
    setDraftStroke(stroke);
    scheduleStrokePreview(stroke);
    setSelectedImageId(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(event);
    pointerPointRef.current = point;
    onCursorMove(canvas.id, point);
    setEraserPoint(tool === "eraser" ? point : null);

    if (tool === "pen" && lineStart && isCtrlLineActive && !draftStrokeRef.current && !dragRef.current) {
      setLinePreviewPoint(point);
      return;
    }

    const drag = dragRef.current;

    if (drag) {
      const nextImage = updateImageFromDrag(drag, point);
      drag.latest = nextImage;
      setDraftImage(nextImage);
      return;
    }

    const stroke = draftStrokeRef.current;
    if (!stroke) {
      return;
    }

    const lastPoint = stroke.points.at(-1);
    if (lastPoint && Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 1.5) {
      return;
    }

    const nextStroke = {
      ...stroke,
      points: [...stroke.points, point]
    };
    draftStrokeRef.current = nextStroke;
    setDraftStroke(nextStroke);
    scheduleStrokePreview(nextStroke);
  }

  function handlePointerLeave() {
    pointerPointRef.current = null;
    onCursorLeave();
    if (!draftStrokeRef.current && !dragRef.current) {
      setEraserPoint(null);
    }
    setIsCtrlLineActive(false);
    setLineStart(null);
    setLinePreviewPoint(null);
  }

  function finishInteraction() {
    const drag = dragRef.current;
    if (drag) {
      const after = drag.latest;
      dragRef.current = null;
      setDraftImage(null);
      if (hasImageChanged(drag.before, after)) {
        onOperation({
          type: "image:update",
          canvasId: canvas.id,
          before: drag.before,
          after
        });
      }
      return;
    }

    const stroke = draftStrokeRef.current;
    draftStrokeRef.current = null;
    setDraftStroke(null);
    if (stroke && stroke.points.length > 1) {
      flushStrokePreview();
      onOperation({
        type: "stroke:add",
        canvasId: canvas.id,
        stroke
      });
      onStrokeEnd(canvas.id, stroke.id);
      return;
    }

    if (stroke) {
      onStrokeEnd(canvas.id, stroke.id);
    }
  }

  return (
    <article className={styles.board}>
      <div className={styles.canvasFrame}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
          onPointerCancel={finishInteraction}
          onPointerLeave={handlePointerLeave}
          aria-label={canvas.title}
        />
      </div>
    </article>
  );
}

function drawCanvas(
  target: HTMLCanvasElement | null,
  canvas: CanvasSnapshot,
  cache: Map<string, HTMLImageElement>,
  draftStroke: Stroke | null,
  draftImage: BoardImage | null,
  selectedImageId: string | null,
  eraserPoint: Point | null,
  eraserSize: number,
  linePreviewStroke: Stroke | null,
  cursors: RemoteCursor[],
  remoteStrokes: RemoteStroke[]
) {
  if (!target) {
    return;
  }

  const context = target.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawGrid(context, CANVAS_WIDTH, CANVAS_HEIGHT);

  const images = draftImage
    ? canvas.images.map((image) => (image.id === draftImage.id ? draftImage : image))
    : canvas.images;

  for (const image of images) {
    drawImage(context, cache, image, () =>
      drawCanvas(
        target,
        canvas,
        cache,
        draftStroke,
        draftImage,
        selectedImageId,
        eraserPoint,
        eraserSize,
        linePreviewStroke,
        cursors,
        remoteStrokes
      )
    );
  }

  const strokeLayer = document.createElement("canvas");
  strokeLayer.width = CANVAS_WIDTH;
  strokeLayer.height = CANVAS_HEIGHT;
  const strokeContext = strokeLayer.getContext("2d");
  if (strokeContext) {
    for (const stroke of [
      ...canvas.strokes,
      ...remoteStrokes.map((stroke) => stroke.stroke),
      ...(draftStroke ? [draftStroke] : []),
      ...(linePreviewStroke ? [linePreviewStroke] : [])
    ]) {
      drawStroke(strokeContext, stroke);
    }
    context.drawImage(strokeLayer, 0, 0);
  }

  const selected = images.find((image) => image.id === selectedImageId);
  if (selected) {
    drawSelection(context, selected);
  }

  if (eraserPoint) {
    drawEraserPreview(context, eraserPoint, eraserSize);
  }

  for (const cursor of cursors) {
    drawRemoteCursor(context, cursor);
  }
}

function resizeCanvasForDisplay(target: HTMLCanvasElement | null) {
  if (!target) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(CANVAS_WIDTH * dpr);
  const height = Math.round(CANVAS_HEIGHT * dpr);

  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }

  const context = target.getContext("2d");
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.strokeStyle = "#d9ded8";
  context.lineWidth = 1;

  for (let x = 0; x <= width; x += GRID_SIZE) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, height);
    context.stroke();
  }

  for (let y = 0; y <= height; y += GRID_SIZE) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(width, y + 0.5);
    context.stroke();
  }

  context.restore();
}

function createLineStroke(start: Point, end: Point, color: string, size: number): Stroke {
  return {
    id: crypto.randomUUID(),
    tool: "pen",
    color,
    size,
    points: [start, end]
  };
}

function drawImage(
  context: CanvasRenderingContext2D,
  cache: Map<string, HTMLImageElement>,
  image: BoardImage,
  onLoad: () => void
) {
  let element = cache.get(image.src);
  if (!element) {
    element = new Image();
    element.onload = onLoad;
    element.src = image.src;
    cache.set(image.src, element);
  }

  if (element.complete) {
    context.drawImage(element, image.x, image.y, image.width, image.height);
  }
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length < 2) {
    return;
  }

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);

  if (stroke.points.length === 2) {
    context.lineTo(stroke.points[1].x, stroke.points[1].y);
  } else {
    for (let index = 1; index < stroke.points.length - 1; index += 1) {
      const current = stroke.points[index];
      const next = stroke.points[index + 1];
      const midpoint = {
        x: (current.x + next.x) / 2,
        y: (current.y + next.y) / 2
      };

      context.quadraticCurveTo(current.x, current.y, midpoint.x, midpoint.y);
    }

    const last = stroke.points.at(-1);
    if (last) {
      context.lineTo(last.x, last.y);
    }
  }

  context.stroke();
  context.restore();
}

function drawSelection(context: CanvasRenderingContext2D, image: BoardImage) {
  context.save();
  context.strokeStyle = "#0f766e";
  context.lineWidth = 2;
  context.setLineDash([8, 6]);
  context.strokeRect(image.x, image.y, image.width, image.height);
  context.setLineDash([]);
  context.fillStyle = "#0f766e";
  context.fillRect(
    image.x + image.width - HANDLE_SIZE,
    image.y + image.height - HANDLE_SIZE,
    HANDLE_SIZE,
    HANDLE_SIZE
  );
  context.restore();
}

function drawEraserPreview(context: CanvasRenderingContext2D, point: Point, size: number) {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, Math.max(1, size / 2), 0, Math.PI * 2);
  context.fillStyle = "rgba(15, 118, 110, 0.08)";
  context.strokeStyle = "#0f766e";
  context.lineWidth = 1.5;
  context.fill();
  context.stroke();
  context.restore();
}

function drawRemoteCursor(context: CanvasRenderingContext2D, cursor: RemoteCursor) {
  context.save();
  context.translate(cursor.point.x, cursor.point.y);
  context.fillStyle = "#0f766e";
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(18, 6);
  context.lineTo(6, 18);
  context.closePath();
  context.stroke();
  context.fill();

  context.font = "18px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.fillText(cursor.name, 18, 18);
  context.restore();
}

function findImageHit(images: BoardImage[], point: Point): BoardImage | null {
  return (
    [...images]
      .reverse()
      .find(
        (image) =>
          point.x >= image.x &&
          point.x <= image.x + image.width &&
          point.y >= image.y &&
          point.y <= image.y + image.height
      ) ?? null
  );
}

function isResizeHandle(image: BoardImage, point: Point): boolean {
  return (
    point.x >= image.x + image.width - HANDLE_SIZE * 1.5 &&
    point.y >= image.y + image.height - HANDLE_SIZE * 1.5
  );
}

function updateImageFromDrag(drag: DragState, point: Point): BoardImage {
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;

  if (drag.mode === "resize") {
    return {
      ...drag.before,
      width: Math.max(40, drag.before.width + dx),
      height: Math.max(40, drag.before.height + dy)
    };
  }

  return {
    ...drag.before,
    x: drag.before.x + dx,
    y: drag.before.y + dy
  };
}

function hasImageChanged(before: BoardImage, after: BoardImage): boolean {
  return (
    before.x !== after.x ||
    before.y !== after.y ||
    before.width !== after.width ||
    before.height !== after.height
  );
}
