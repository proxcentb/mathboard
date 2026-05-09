import { useEffect, useRef } from "react";
import { BoardImage, CanvasSnapshot, Stroke } from "../types";
import styles from "./CanvasPreview.module.css";

const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 156;
const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 720;
const GRID_SIZE = 24;

interface CanvasPreviewProps {
  canvas: CanvasSnapshot;
}

export function CanvasPreview({ canvas }: CanvasPreviewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef(new Map<string, HTMLImageElement>());

  useEffect(() => {
    resizePreviewForDisplay(ref.current);
    drawPreview(ref.current, canvas, cacheRef.current);
  }, [canvas]);

  return (
    <canvas
      ref={ref}
      className={styles.preview}
      aria-hidden
    />
  );
}

function drawPreview(
  target: HTMLCanvasElement | null,
  canvas: CanvasSnapshot,
  cache: Map<string, HTMLImageElement>
) {
  if (!target) {
    return;
  }

  const context = target.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  context.save();
  context.scale(PREVIEW_WIDTH / SOURCE_WIDTH, PREVIEW_HEIGHT / SOURCE_HEIGHT);
  drawGrid(context, SOURCE_WIDTH, SOURCE_HEIGHT);

  for (const image of canvas.images) {
    drawImage(context, cache, image, () => drawPreview(target, canvas, cache));
  }

  const strokeLayer = document.createElement("canvas");
  strokeLayer.width = SOURCE_WIDTH;
  strokeLayer.height = SOURCE_HEIGHT;
  const strokeContext = strokeLayer.getContext("2d");
  if (strokeContext) {
    for (const stroke of canvas.strokes) {
      drawStroke(strokeContext, stroke);
    }
    context.drawImage(strokeLayer, 0, 0);
  }

  context.restore();
}

function resizePreviewForDisplay(target: HTMLCanvasElement | null) {
  if (!target) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(PREVIEW_WIDTH * dpr);
  const height = Math.round(PREVIEW_HEIGHT * dpr);

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
      context.quadraticCurveTo(
        current.x,
        current.y,
        (current.x + next.x) / 2,
        (current.y + next.y) / 2
      );
    }

    const last = stroke.points.at(-1);
    if (last) {
      context.lineTo(last.x, last.y);
    }
  }

  context.stroke();
  context.restore();
}
