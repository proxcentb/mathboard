import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import styles from "./BoardCanvas.module.css";
import { resolveCursorAvatarSrc } from "../cursorAssets";
import {
  BoardImage,
  BoardOperation,
  CanvasSnapshot,
  DrawingTool,
  ParticipantAvatar,
  Point,
  RemoteCursor,
  RemoteCursorStore,
  RemoteStroke,
  Stroke
} from "../types";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 720;
const GRID_SIZE = 24;
const HANDLE_SIZE = 18;
const LIVE_EVENT_INTERVAL_MS = 50;

interface BoardCanvasProps {
  canvas: CanvasSnapshot;
  tool: DrawingTool;
  color: string;
  size: number;
  cursorStore: RemoteCursorStore;
  remoteStrokes: RemoteStroke[];
  localCursorName: string;
  localCursorAvatar: ParticipantAvatar;
  localCursorImageSrc?: string;
  onOperation: (operation: BoardOperation) => void;
  onCursorMove: (canvasId: string, point: Point) => void;
  onCursorLeave: () => void;
  onStrokePreview: (canvasId: string, stroke: Stroke, isStart: boolean) => void;
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
  cursorStore,
  remoteStrokes,
  localCursorName,
  localCursorAvatar,
  localCursorImageSrc,
  onOperation,
  onCursorMove,
  onCursorLeave,
  onStrokePreview,
  onStrokeEnd
}: BoardCanvasProps) {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const remoteCursorLayerRef = useRef<HTMLDivElement | null>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const draftStrokeRef = useRef<Stroke | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointerPointRef = useRef<Point | null>(null);
  const cursorTimeoutRef = useRef<number | null>(null);
  const lastCursorSentAtRef = useRef(0);
  const pendingCursorPointRef = useRef<Point | null>(null);
  const liveStrokeTimeoutRef = useRef<number | null>(null);
  const lastLiveStrokeAtRef = useRef(0);
  const pendingLivePointsRef = useRef<Point[]>([]);
  const liveStrokeStartedRef = useRef(false);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const [draftImage, setDraftImage] = useState<BoardImage | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [lineStart, setLineStart] = useState<Point | null>(null);
  const [linePreviewPoint, setLinePreviewPoint] = useState<Point | null>(null);
  const [isCtrlLineActive, setIsCtrlLineActive] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);
  const [imageCursorUrl, setImageCursorUrl] = useState<string | null>(null);

  const cursorStyle = useMemo<CSSProperties>(
    () =>
      createNativeCursorStyle(
        tool,
        color,
        size,
        canvasScale,
        localCursorName,
        localCursorAvatar,
        imageCursorUrl
      ),
    [canvasScale, color, imageCursorUrl, localCursorAvatar, localCursorName, size, tool]
  );

  const drawBase = useCallback(() => {
    resizeCanvasForDisplay(baseCanvasRef.current);
    drawBaseCanvas(
      baseCanvasRef.current,
      canvas,
      imageCacheRef.current,
      draftImage,
      () => drawBaseCanvas(baseCanvasRef.current, canvas, imageCacheRef.current, draftImage)
    );
  }, [canvas, draftImage]);

  const drawOverlay = useCallback(() => {
    resizeCanvasForDisplay(overlayCanvasRef.current);
    drawOverlayCanvas(
      overlayCanvasRef.current,
      canvas,
      imageCacheRef.current,
      draftStroke,
      draftImage,
      selectedImageId,
      lineStart && linePreviewPoint ? createLineStroke(lineStart, linePreviewPoint, color, size) : null,
      remoteStrokes
    );
  }, [
    canvas,
    color,
    draftImage,
    draftStroke,
    linePreviewPoint,
    lineStart,
    remoteStrokes,
    selectedImageId,
    size
  ]);

  useEffect(() => {
    return () => {
      const stroke = draftStrokeRef.current;
      if (stroke) {
        onStrokeEnd(canvas.id, stroke.id);
      }

      if (liveStrokeTimeoutRef.current) {
        window.clearTimeout(liveStrokeTimeoutRef.current);
      }

      if (cursorTimeoutRef.current) {
        window.clearTimeout(cursorTimeoutRef.current);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Delete" && event.code !== "Backspace") {
        return;
      }

      const target = event.target;
      const isTextEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isTextEditing || draftStrokeRef.current || dragRef.current) {
        return;
      }

      const selectedImage = canvas.images.find((image) => image.id === selectedImageId);
      if (!selectedImage) {
        return;
      }

      event.preventDefault();
      onOperation({
        type: "image:delete",
        canvasId: canvas.id,
        imageId: selectedImage.id
      });
      setSelectedImageId(null);
      setDraftImage(null);
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [canvas.id, canvas.images, onOperation, selectedImageId]);

  useEffect(() => {
    drawBase();
  }, [drawBase]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    let frame = 0;
    const redraw = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        updateCanvasScale(overlayCanvasRef.current, setCanvasScale);
        drawBase();
        drawOverlay();
      });
    };

    const observer = new ResizeObserver(redraw);
    const baseCanvas = baseCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (baseCanvas) {
      observer.observe(baseCanvas);
    }
    if (overlayCanvas) {
      observer.observe(overlayCanvas);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [drawBase, drawOverlay]);

  useEffect(() => {
    if (localCursorAvatar.type !== "image" || !localCursorImageSrc) {
      return;
    }

    let ignored = false;
    const cursorColor = tool === "eraser" ? "#0f766e" : color;
    void createImageCursorUrl(localCursorImageSrc, cursorColor)
      .then((url) => {
        if (!ignored) {
          setImageCursorUrl(url);
        }
      })
      .catch(() => {
        if (!ignored) {
          setImageCursorUrl(null);
        }
      });

    return () => {
      ignored = true;
    };
  }, [color, localCursorAvatar, localCursorImageSrc, tool]);

  useEffect(() => {
    const layer = remoteCursorLayerRef.current;
    if (!layer) {
      return;
    }

    const nodes = new Map<string, HTMLDivElement>();
    const latestCursors = new Map<string, RemoteCursor>();
    const pendingUpdates = new Map<string, RemoteCursor>();
    const pendingLeaves = new Set<string>();
    let frame = 0;

    const removeNode = (socketId: string) => {
      nodes.get(socketId)?.remove();
      nodes.delete(socketId);
    };

    const getNode = (cursor: RemoteCursor) => {
      let node = nodes.get(cursor.socketId);
      if (node) {
        return node;
      }

      node = document.createElement("div");
      node.className = styles.remoteCursor;
      layer.append(node);
      nodes.set(cursor.socketId, node);
      return node;
    };

    const updateNode = (cursor: RemoteCursor) => {
      if (cursor.canvasId !== canvas.id) {
        removeNode(cursor.socketId);
        return;
      }

      const node = getNode(cursor);
      updateRemoteCursorAvatar(node, cursor);
      node.style.setProperty("--cursor-color", cursor.color ?? "#0f766e");

      const rect = layer.getBoundingClientRect();
      const x = (cursor.point.x / CANVAS_WIDTH) * rect.width;
      const y = (cursor.point.y / CANVAS_HEIGHT) * rect.height;
      node.style.transform = `translate3d(${x - 9}px, ${y - 9}px, 0)`;
    };

    const flush = () => {
      frame = 0;
      for (const socketId of pendingLeaves) {
        removeNode(socketId);
      }
      pendingLeaves.clear();

      for (const cursor of pendingUpdates.values()) {
        updateNode(cursor);
      }
      pendingUpdates.clear();
    };

    const scheduleFlush = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(flush);
    };

    const queueUpdate = (cursor: RemoteCursor) => {
      latestCursors.set(cursor.socketId, cursor);
      pendingLeaves.delete(cursor.socketId);
      pendingUpdates.set(cursor.socketId, cursor);
      scheduleFlush();
    };

    const queueLeave = (socketId: string) => {
      latestCursors.delete(socketId);
      pendingUpdates.delete(socketId);
      pendingLeaves.add(socketId);
      scheduleFlush();
    };

    for (const cursor of cursorStore.getSnapshot()) {
      queueUpdate(cursor);
    }

    const unsubscribe = cursorStore.subscribe((event) => {
      if (event.type === "update") {
        queueUpdate(event.cursor);
        return;
      }
      queueLeave(event.socketId);
    });

    const observer = new ResizeObserver(() => {
      for (const cursor of latestCursors.values()) {
        pendingUpdates.set(cursor.socketId, cursor);
      }
      scheduleFlush();
    });
    observer.observe(layer);

    return () => {
      unsubscribe();
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      layer.replaceChildren();
    };
  }, [canvas.id, cursorStore]);

  function scheduleCursorMove(point: Point, immediate = false) {
    pendingCursorPointRef.current = point;
    const now = window.performance.now();
    const elapsed = now - lastCursorSentAtRef.current;

    if (immediate || elapsed >= LIVE_EVENT_INTERVAL_MS) {
      flushCursorMove();
      return;
    }

    if (cursorTimeoutRef.current) {
      return;
    }

    cursorTimeoutRef.current = window.setTimeout(
      flushCursorMove,
      LIVE_EVENT_INTERVAL_MS - elapsed
    );
  }

  function flushCursorMove() {
    if (cursorTimeoutRef.current) {
      window.clearTimeout(cursorTimeoutRef.current);
      cursorTimeoutRef.current = null;
    }

    const point = pendingCursorPointRef.current;
    if (!point) {
      return;
    }

    pendingCursorPointRef.current = null;
    lastCursorSentAtRef.current = window.performance.now();
    onCursorMove(canvas.id, point);
  }

  function scheduleStrokePreview(points: Point[]) {
    pendingLivePointsRef.current = [...pendingLivePointsRef.current, ...points];
    const now = window.performance.now();
    const elapsed = now - lastLiveStrokeAtRef.current;

    if (elapsed >= LIVE_EVENT_INTERVAL_MS) {
      flushStrokePreview();
      return;
    }

    if (liveStrokeTimeoutRef.current) {
      return;
    }

    liveStrokeTimeoutRef.current = window.setTimeout(
      flushStrokePreview,
      LIVE_EVENT_INTERVAL_MS - elapsed
    );
  }

  function flushStrokePreview() {
    if (liveStrokeTimeoutRef.current) {
      window.clearTimeout(liveStrokeTimeoutRef.current);
      liveStrokeTimeoutRef.current = null;
    }

    const draftStroke = draftStrokeRef.current;
    const points = pendingLivePointsRef.current;
    if (!draftStroke || points.length === 0) {
      return;
    }

    pendingLivePointsRef.current = [];
    lastLiveStrokeAtRef.current = window.performance.now();
    onStrokePreview(
      canvas.id,
      {
        ...draftStroke,
        points
      },
      !liveStrokeStartedRef.current
    );
    liveStrokeStartedRef.current = true;
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
    scheduleCursorMove(point, true);
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

    const stroke: Stroke = {
      id: crypto.randomUUID(),
      tool,
      color,
      size,
      points: [point]
    };
    draftStrokeRef.current = stroke;
    setDraftStroke(stroke);
    liveStrokeStartedRef.current = false;
    pendingLivePointsRef.current = [];
    scheduleStrokePreview([point]);
    setSelectedImageId(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(event);
    pointerPointRef.current = point;
    scheduleCursorMove(point);

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
    scheduleStrokePreview([point]);
  }

  function handlePointerLeave() {
    pointerPointRef.current = null;
    pendingCursorPointRef.current = null;
    if (cursorTimeoutRef.current) {
      window.clearTimeout(cursorTimeoutRef.current);
      cursorTimeoutRef.current = null;
    }
    onCursorLeave();
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
          image: imagePlacement(after)
        });
      }
      return;
    }

    const stroke = draftStrokeRef.current;
    if (stroke && stroke.points.length > 1) {
      flushStrokePreview();
      draftStrokeRef.current = null;
      setDraftStroke(null);
      liveStrokeStartedRef.current = false;
      onOperation({
        type: "stroke:add",
        canvasId: canvas.id,
        stroke
      });
      onStrokeEnd(canvas.id, stroke.id);
      return;
    }

    draftStrokeRef.current = null;
    setDraftStroke(null);
    liveStrokeStartedRef.current = false;
    if (stroke) {
      pendingLivePointsRef.current = [];
      onStrokeEnd(canvas.id, stroke.id);
    }
  }

  return (
    <article className={styles.board}>
      <div className={styles.canvasFrame}>
        <canvas
          ref={baseCanvasRef}
          className={`${styles.canvas} ${styles.baseCanvas}`}
          aria-hidden="true"
        />
        <canvas
          ref={overlayCanvasRef}
          className={styles.canvas}
          style={cursorStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishInteraction}
          onPointerCancel={finishInteraction}
          onPointerLeave={handlePointerLeave}
          aria-label={canvas.title}
        />
        <div ref={remoteCursorLayerRef} className={styles.remoteCursorLayer} aria-hidden="true" />
      </div>
    </article>
  );
}

function cursorAvatar(cursor: Pick<RemoteCursor, "avatar" | "name">): ParticipantAvatar {
  return (
    cursor.avatar ?? {
      type: "emoji",
      value: cursor.name
    }
  );
}

function cursorAvatarKey(avatar: ParticipantAvatar): string {
  return avatar.type === "emoji" ? `emoji:${avatar.value}` : `image:${avatar.name}`;
}

function updateRemoteCursorAvatar(node: HTMLDivElement, cursor: RemoteCursor) {
  const avatar = cursorAvatar(cursor);
  const key = cursorAvatarKey(avatar);
  if (node.dataset.avatarKey === key) {
    return;
  }

  node.dataset.avatarKey = key;
  node.replaceChildren();

  if (avatar.type === "emoji") {
    const name = document.createElement("span");
    name.className = styles.remoteCursorName;
    name.textContent = avatar.value;
    node.append(name);
    return;
  }

  const src = resolveCursorAvatarSrc(avatar);
  if (!src) {
    const name = document.createElement("span");
    name.className = styles.remoteCursorName;
    name.textContent = avatar.alt ?? avatar.name;
    node.append(name);
    return;
  }

  const image = document.createElement("img");
  image.className = `${styles.remoteCursorName} ${styles.remoteCursorImage}`;
  image.src = src;
  image.alt = avatar.alt ?? avatar.name;
  image.draggable = false;
  node.append(image);
}

function drawBaseCanvas(
  target: HTMLCanvasElement | null,
  canvas: CanvasSnapshot,
  cache: Map<string, HTMLImageElement>,
  draftImage: BoardImage | null,
  onImageLoad?: () => void
) {
  if (!target) {
    return;
  }

  const context = target.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawBoardBackground(context, CANVAS_WIDTH, CANVAS_HEIGHT);

  const images = draftImage
    ? canvas.images.map((image) => (image.id === draftImage.id ? draftImage : image))
    : canvas.images;

  for (const image of images) {
    drawImage(context, cache, image, onImageLoad ?? (() => undefined));
  }

  drawStrokeLayer(context, canvas.strokes);
}

function drawOverlayCanvas(
  target: HTMLCanvasElement | null,
  canvas: CanvasSnapshot,
  cache: Map<string, HTMLImageElement>,
  draftStroke: Stroke | null,
  draftImage: BoardImage | null,
  selectedImageId: string | null,
  linePreviewStroke: Stroke | null,
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

  const images = draftImage
    ? canvas.images.map((image) => (image.id === draftImage.id ? draftImage : image))
    : canvas.images;

  const overlayStrokes = [
    ...remoteStrokes.map((stroke) => stroke.stroke),
    ...(draftStroke ? [draftStroke] : []),
    ...(linePreviewStroke ? [linePreviewStroke] : [])
  ];

  if (overlayStrokes.some((stroke) => stroke.tool === "eraser")) {
    drawBoardBackground(context, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const image of images) {
      drawImage(context, cache, image, () =>
        drawOverlayCanvas(
          target,
          canvas,
          cache,
          draftStroke,
          draftImage,
          selectedImageId,
          linePreviewStroke,
          remoteStrokes
        )
      );
    }
    drawStrokeLayer(context, [
      ...canvas.strokes,
      ...overlayStrokes
    ]);
  } else {
    drawStrokeLayer(context, overlayStrokes);
  }

  const selected = images.find((image) => image.id === selectedImageId);
  if (selected) {
    drawSelection(context, selected);
  }
}

function drawBoardBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.restore();
  drawGrid(context, width, height);
}

function drawStrokeLayer(context: CanvasRenderingContext2D, strokes: Stroke[]) {
  if (strokes.length === 0) {
    return;
  }

  const strokeLayer = document.createElement("canvas");
  strokeLayer.width = context.canvas.width;
  strokeLayer.height = context.canvas.height;
  const strokeContext = strokeLayer.getContext("2d");
  if (!strokeContext) {
    return;
  }

  strokeContext.setTransform(
    strokeLayer.width / CANVAS_WIDTH,
    0,
    0,
    strokeLayer.height / CANVAS_HEIGHT,
    0,
    0
  );

  for (const stroke of strokes) {
    drawStroke(strokeContext, stroke);
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(strokeLayer, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function resizeCanvasForDisplay(target: HTMLCanvasElement | null) {
  if (!target) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }

  const context = target.getContext("2d");
  if (!context) {
    return;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.setTransform(width / CANVAS_WIDTH, 0, 0, height / CANVAS_HEIGHT, 0, 0);
}

function updateCanvasScale(
  target: HTMLCanvasElement | null,
  setScale: Dispatch<SetStateAction<number>>
) {
  if (!target) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const nextScale = rect.width / CANVAS_WIDTH;
  setScale((currentScale) =>
    Math.abs(currentScale - nextScale) < 0.005 ? currentScale : nextScale
  );
}

function createImageCursorUrl(src: string, color: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const cursorSize = 64;
      const hotspot = 12;
      const canvas = document.createElement("canvas");
      canvas.width = cursorSize;
      canvas.height = cursorSize;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not create cursor canvas"));
        return;
      }

      context.lineCap = "round";
      context.strokeStyle = "#ffffff";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(hotspot, 3);
      context.lineTo(hotspot, 21);
      context.moveTo(3, hotspot);
      context.lineTo(21, hotspot);
      context.stroke();

      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(hotspot, 4);
      context.lineTo(hotspot, 20);
      context.moveTo(4, hotspot);
      context.lineTo(20, hotspot);
      context.stroke();

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 23, 18, 30, 30);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Could not load cursor image"));
    image.src = src;
  });
}

function createNativeCursorStyle(
  tool: DrawingTool,
  color: string,
  size: number,
  canvasScale: number,
  localCursorName: string,
  localCursorAvatar: ParticipantAvatar,
  imageCursorUrl: string | null
): CSSProperties {
  const visibleSize = clampNumber(size * canvasScale, tool === "eraser" ? 12 : 8, 120);
  if (localCursorAvatar.type === "image") {
    const hotspot = 12;
    return {
      cursor: imageCursorUrl
        ? `url("${imageCursorUrl}") ${hotspot} ${hotspot}, crosshair`
        : "crosshair"
    };
  }

  const cursorSize = Math.ceil(clampNumber(visibleSize + 56, 64, 128));
  const center = Math.round(clampNumber(visibleSize / 2 + 8, 12, 64));
  const radius = Math.max(2, visibleSize / 2);
  const lineLength = Math.round(clampNumber(visibleSize / 2 + 7, 8, 18));
  const label = escapeSvgText(
    localCursorAvatar.type === "emoji" ? localCursorAvatar.value : localCursorName
  );
  const svg =
    tool === "eraser"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}"><circle cx="${center}" cy="${center}" r="${Math.min(radius, center - 3)}" fill="rgba(255,255,255,.78)" stroke="#0f766e" stroke-width="2"/><circle cx="${center}" cy="${center}" r="1.5" fill="#0f766e"/><text x="${center + 13}" y="${center + 18}" font-size="18" font-family="system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif" fill="#17201f" stroke="#ffffff" stroke-width="3" paint-order="stroke">${label}</text></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}"><path d="M${center} ${center - lineLength}V${center + lineLength}M${center - lineLength} ${center}H${center + lineLength}" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M${center} ${center - lineLength}V${center + lineLength}M${center - lineLength} ${center}H${center + lineLength}" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="${center}" cy="${center}" r="${Math.min(radius, lineLength - 2)}" fill="none" stroke="${color}" stroke-width="1.5"/><text x="${center + 13}" y="${center + 18}" font-size="18" font-family="system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif" fill="#17201f" stroke="#ffffff" stroke-width="3" paint-order="stroke">${label}</text></svg>`;

  return {
    cursor: `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${center} ${center}, crosshair`
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
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

function imagePlacement(image: BoardImage) {
  return {
    id: image.id,
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height
  };
}
