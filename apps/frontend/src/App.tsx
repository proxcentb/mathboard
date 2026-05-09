import * as Toolbar from "@radix-ui/react-toolbar";
import { Brush, Copy, Eraser, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_URL, createRoom, getRoom, sendOperation } from "./api";
import styles from "./App.module.css";
import { BoardCanvas } from "./components/BoardCanvas";
import { CanvasPreview } from "./components/CanvasPreview";
import {
  BoardImage,
  BoardOperation,
  DrawingTool,
  ParticipantProfile,
  Point,
  RemoteCursor,
  RemoteStroke,
  RoomSnapshot,
  Stroke
} from "./types";

const DEFAULT_PROFILE: ParticipantProfile = {
  slot: 0,
  name: "🦊",
  color: "#1d4ed8"
};
const PROFILE_EMOJIS = ["🦊", "🐼", "🐸", "🐯", "🐨", "🐰", "🐧", "🐙", "🦉", "🦁", "🐢", "🐳"];

function currentRoomId(): string | null {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function App() {
  const [roomId, setRoomId] = useState(() => currentRoomId());
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [tool, setTool] = useState<DrawingTool>("pen");
  const [color, setColor] = useState("#1d4ed8");
  const [brushSize, setBrushSize] = useState(1);
  const [eraserSize, setEraserSize] = useState(50);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [remoteStrokes, setRemoteStrokes] = useState<RemoteStroke[]>([]);
  const [profile, setProfile] = useState<ParticipantProfile>(DEFAULT_PROFILE);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const shouldSelectCreatedCanvasRef = useRef(false);

  useEffect(() => {
    const onPopState = () => setRoomId(currentRoomId());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    let ignored = false;
    void getRoom(roomId).then((snapshot) => {
      if (!ignored) {
        setRoom(snapshot);
        setActiveCanvasId((current) => current ?? snapshot.canvases[0]?.id ?? null);
      }
    });

    return () => {
      ignored = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const socket = io(API_URL, {
      transports: ["websocket", "polling"]
    });

    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("room:join", { roomId });
    });
    socket.on("room:profile", (nextProfile: ParticipantProfile) => {
      setProfile(nextProfile);
      setColor(nextProfile.color);
    });
    socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
      setRoom(snapshot);
      setActiveCanvasId((current) => {
        if (shouldSelectCreatedCanvasRef.current) {
          shouldSelectCreatedCanvasRef.current = false;
          return snapshot.canvases.at(-1)?.id ?? current;
        }

        return current ?? snapshot.canvases[0]?.id ?? null;
      });
    });
    socket.on("cursor:update", (cursor: RemoteCursor) => {
      setRemoteCursors((current) => [
        ...current.filter((item) => item.socketId !== cursor.socketId),
        cursor
      ]);
    });
    socket.on("cursor:leave", ({ socketId }: { socketId: string }) => {
      setRemoteCursors((current) => current.filter((item) => item.socketId !== socketId));
    });
    socket.on("stroke:preview", (stroke: RemoteStroke) => {
      setRemoteStrokes((current) => [
        ...current.filter(
          (item) => item.socketId !== stroke.socketId || item.stroke.id !== stroke.stroke.id
        ),
        stroke
      ]);
    });
    socket.on(
      "stroke:end",
      ({ socketId, canvasId, strokeId }: { socketId: string; canvasId?: string; strokeId?: string }) => {
        setRemoteStrokes((current) =>
          current.filter((item) => {
            if (item.socketId !== socketId) {
              return true;
            }

            if (canvasId && item.canvasId !== canvasId) {
              return true;
            }

            if (strokeId && item.stroke.id !== strokeId) {
              return true;
            }

            return false;
          })
        );
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setRemoteCursors([]);
      setRemoteStrokes([]);
    };
  }, [roomId]);

  const activeCanvas = useMemo(
    () => room?.canvases.find((canvas) => canvas.id === activeCanvasId) ?? room?.canvases[0],
    [activeCanvasId, room?.canvases]
  );

  const activeCanvasCursors = useMemo(
    () => remoteCursors.filter((cursor) => cursor.canvasId === activeCanvas?.id),
    [activeCanvas?.id, remoteCursors]
  );

  const activeCanvasRemoteStrokes = useMemo(
    () => remoteStrokes.filter((stroke) => stroke.canvasId === activeCanvas?.id),
    [activeCanvas?.id, remoteStrokes]
  );

  const emitOperation = useCallback(
    (operation: BoardOperation) => {
      if (!roomId) {
        return;
      }

      setRoom((current) => applyOptimisticOperation(current, operation));

      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit("room:operation", { roomId, operation });
        return;
      }

      void sendOperation(roomId, operation).then(setRoom);
    },
    [roomId]
  );

  const openNewRoom = useCallback(async () => {
    const snapshot = await createRoom();
    window.history.pushState(null, "", `/r/${snapshot.id}`);
    setRoomId(snapshot.id);
    setRoom(snapshot);
    setActiveCanvasId(snapshot.canvases[0]?.id ?? null);
  }, []);

  const addCanvas = useCallback(() => {
    if (!roomId) {
      return;
    }

    shouldSelectCreatedCanvasRef.current = true;
    const operation: BoardOperation = { type: "canvas:create" };
    const socket = socketRef.current;

    if (socket?.connected) {
      socket.emit("room:operation", { roomId, operation });
      return;
    }

    void sendOperation(roomId, operation).then((snapshot) => {
      setRoom(snapshot);
      setActiveCanvasId(snapshot.canvases.at(-1)?.id ?? null);
    });
  }, [roomId]);

  const emitCursorMove = useCallback(
    (canvasId: string, point: Point) => {
      if (!roomId) {
        return;
      }

      socketRef.current?.emit("cursor:update", {
        roomId,
        canvasId,
        name: profile.name,
        point
      });
    },
    [profile.name, roomId]
  );

  const emitCursorLeave = useCallback(() => {
    if (!roomId) {
      return;
    }

    socketRef.current?.emit("cursor:leave", { roomId });
  }, [roomId]);

  const emitStrokePreview = useCallback(
    (canvasId: string, stroke: Stroke) => {
      if (!roomId) {
        return;
      }

      socketRef.current?.emit("stroke:preview", {
        roomId,
        canvasId,
        stroke
      });
    },
    [roomId]
  );

  const emitStrokeEnd = useCallback(
    (canvasId: string, strokeId: string) => {
      if (!roomId) {
        return;
      }

      socketRef.current?.emit("stroke:end", {
        roomId,
        canvasId,
        strokeId
      });
    },
    [roomId]
  );

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
  }, []);

  const clearCanvas = useCallback(() => {
    if (!activeCanvas || (activeCanvas.strokes.length === 0 && activeCanvas.images.length === 0)) {
      return;
    }

    emitOperation({
      type: "canvas:clear",
      canvasId: activeCanvas.id,
      before: {
        strokes: activeCanvas.strokes,
        images: activeCanvas.images
      }
    });
  }, [activeCanvas, emitOperation]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextEditing =
        (target instanceof HTMLInputElement &&
          !["button", "checkbox", "color", "range"].includes(target.type)) ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isTextEditing) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
        event.preventDefault();
        if (!activeCanvas) {
          return;
        }

        emitOperation({
          type: event.shiftKey ? "history:redo" : "history:undo",
          canvasId: activeCanvas.id
        });
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.code === "KeyB") {
        event.preventDefault();
        setTool("pen");
      }

      if (event.code === "KeyE") {
        event.preventDefault();
        setTool("eraser");
      }
    };

    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [activeCanvas, emitOperation]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!room || !activeCanvas) {
        return;
      }

      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith("image/")
      );
      const file = item?.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const image = new Image();
        image.onload = () => {
          const maxWidth = 420;
          const scale = Math.min(1, maxWidth / image.naturalWidth);
          const pastedImage: BoardImage = {
            id: crypto.randomUUID(),
            src,
            x: 96,
            y: 96,
            width: Math.max(80, Math.round(image.naturalWidth * scale)),
            height: Math.max(80, Math.round(image.naturalHeight * scale))
          };

          emitOperation({
            type: "image:add",
            canvasId: activeCanvas.id,
            image: pastedImage
          });
        };
        image.src = src;
      };
      reader.readAsDataURL(file);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeCanvas, emitOperation, room]);

  if (!roomId) {
    return <StartScreen onCreateRoom={openNewRoom} />;
  }

  return (
    <main className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.identity}>
          <div className={styles.logo}>M</div>
          <div>
            <h1>Mathboard</h1>
            <span className={styles.roomLine}>/r/{roomId}</span>
          </div>
          <button className={styles.copyButton} onClick={copyLink} type="button" aria-label="Скопировать ссылку">
            <Copy size={16} />
          </button>
        </div>

        <Toolbar.Root className={styles.toolbar} aria-label="Инструменты доски">
          <Toolbar.ToggleGroup
            className={styles.segment}
            type="single"
            value={tool}
            onValueChange={(value) => value && setTool(value as DrawingTool)}
            aria-label="Инструмент"
          >
            <Toolbar.ToggleItem className={styles.toolButton} value="pen" aria-label="Кисть">
              <Brush size={17} />
              <span>Кисть</span>
            </Toolbar.ToggleItem>
            <Toolbar.ToggleItem className={styles.toolButton} value="eraser" aria-label="Ластик">
              <Eraser size={17} />
              <span>Ластик</span>
            </Toolbar.ToggleItem>
          </Toolbar.ToggleGroup>

          <div className={styles.colorRow}>
            <div className={styles.emojiPicker}>
              <button
                className={styles.emojiButton}
                type="button"
                aria-label="Выбрать emoji профиля"
                aria-expanded={isEmojiPickerOpen}
                onClick={() => setIsEmojiPickerOpen((current) => !current)}
              >
                {profile.name}
              </button>
              {isEmojiPickerOpen ? (
                <div className={styles.emojiPopover} role="menu">
                  <div className={styles.emojiGrid}>
                    {PROFILE_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        className={styles.emojiChoice}
                        data-active={emoji === profile.name}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfile((current) => ({
                            ...current,
                            name: emoji
                          }));
                          setIsEmojiPickerOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <label className={styles.colorControl} aria-label="Цвет кисти">
              <span>Цвет</span>
              <span className={styles.colorSwatch} style={{ backgroundColor: color }} />
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
          </div>

          <label className={styles.rangeControl}>
            <span>Размер</span>
            <strong>{tool === "pen" ? brushSize : eraserSize}px</strong>
            <input
              type="range"
              min={1}
              max={tool === "pen" ? 48 : 80}
              value={tool === "pen" ? brushSize : eraserSize}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                if (tool === "pen") {
                  setBrushSize(nextValue);
                } else {
                  setEraserSize(nextValue);
                }
              }}
            />
          </label>

          <div className={styles.historyRow}>
            <Toolbar.Button
              className={styles.actionButton}
              onClick={() =>
                activeCanvas && emitOperation({ type: "history:undo", canvasId: activeCanvas.id })
              }
              disabled={!activeCanvas?.canUndo}
              aria-label="Отменить"
            >
              <Undo2 size={17} />
              <span>Назад</span>
            </Toolbar.Button>
            <Toolbar.Button
              className={styles.actionButton}
              onClick={() =>
                activeCanvas && emitOperation({ type: "history:redo", canvasId: activeCanvas.id })
              }
              disabled={!activeCanvas?.canRedo}
              aria-label="Вернуть"
            >
              <Redo2 size={17} />
              <span>Вперед</span>
            </Toolbar.Button>
          </div>

          <Toolbar.Button
            className={styles.actionButton}
            onClick={clearCanvas}
            disabled={!activeCanvas || (activeCanvas.strokes.length === 0 && activeCanvas.images.length === 0)}
            aria-label="Очистить холст"
          >
            <Trash2 size={17} />
            <span>Очистить холст</span>
          </Toolbar.Button>
        </Toolbar.Root>

        <section className={styles.previewPanel} aria-label="Холсты">
          <div className={styles.previewList}>
            {room?.canvases.map((canvas, index) => (
              <button
                key={canvas.id}
                className={styles.previewButton}
                data-active={canvas.id === activeCanvas?.id}
                onClick={() => setActiveCanvasId(canvas.id)}
                type="button"
              >
                <CanvasPreview canvas={canvas} />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
          <button className={styles.addCanvasButton} onClick={addCanvas} type="button">
            <Plus size={17} aria-hidden />
            <span>Холст</span>
          </button>
        </section>
      </aside>

      <section className={styles.boardStage}>
        {activeCanvas ? (
          <BoardCanvas
            key={activeCanvas.id}
            canvas={activeCanvas}
            tool={tool}
            color={color}
            size={tool === "pen" ? brushSize : eraserSize}
            cursors={activeCanvasCursors}
            remoteStrokes={activeCanvasRemoteStrokes}
            onOperation={emitOperation}
            onCursorMove={emitCursorMove}
            onCursorLeave={emitCursorLeave}
            onStrokePreview={emitStrokePreview}
            onStrokeEnd={emitStrokeEnd}
          />
        ) : null}
      </section>
    </main>
  );
}

interface StartScreenProps {
  onCreateRoom: () => void;
}

function StartScreen({ onCreateRoom }: StartScreenProps) {
  return (
    <main className={styles.startScreen}>
      <section className={styles.startPanel}>
        <div className={styles.logoLarge}>M</div>
        <h1>Mathboard</h1>
        <p>Общий лист в клетку для быстрых рисунков, схем и заметок.</p>
        <button className={styles.primaryButton} onClick={onCreateRoom}>
          <Plus size={18} aria-hidden />
          Создать страницу
        </button>
      </section>
    </main>
  );
}

function applyOptimisticOperation(
  room: RoomSnapshot | null,
  operation: BoardOperation
): RoomSnapshot | null {
  if (!room) {
    return room;
  }

  if (
    operation.type !== "stroke:add" &&
    operation.type !== "image:add" &&
    operation.type !== "image:update" &&
    operation.type !== "canvas:clear"
  ) {
    return room;
  }

  return {
    ...room,
    updatedAt: Date.now(),
    canvases: room.canvases.map((canvas) => {
      if (canvas.id !== operation.canvasId) {
        return canvas;
      }

      if (operation.type === "stroke:add") {
        return {
          ...canvas,
          strokes: [...canvas.strokes, operation.stroke],
          canUndo: true,
          canRedo: false
        };
      }

      if (operation.type === "image:add") {
        return {
          ...canvas,
          images: [...canvas.images, operation.image],
          canUndo: true,
          canRedo: false
        };
      }

      if (operation.type === "canvas:clear") {
        return {
          ...canvas,
          strokes: [],
          images: [],
          canUndo: true,
          canRedo: false
        };
      }

      return {
        ...canvas,
        images: canvas.images.map((image) =>
          image.id === operation.after.id ? operation.after : image
        ),
        canUndo: true,
        canRedo: false
      };
    })
  };
}
