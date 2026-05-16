import * as Toolbar from "@radix-ui/react-toolbar";
import { Brush, Copy, Download, Eraser, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { SOCKET_URL, createRoom, getRoom, importRoom, sendOperation, uploadImage } from "./api";
import styles from "./App.module.css";
import { BoardCanvas } from "./components/BoardCanvas";
import { CanvasPreview } from "./components/CanvasPreview";
import {
  BoardImage,
  BoardOperation,
  DrawingTool,
  ImportedRoomSnapshot,
  MathboardExportFile,
  OperationAppliedMessage,
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
const MIN_TOOL_SIZE = 1;
const MAX_BRUSH_SIZE = 48;
const MAX_ERASER_SIZE = 120;

function currentRoomId(): string | null {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/);
  return match?.[1] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function imageSourceToDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) {
    return src;
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error("Could not export image");
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function parseImportFile(content: string): MathboardExportFile {
  const parsed = JSON.parse(content) as Partial<MathboardExportFile>;
  if (
    parsed.app !== "mathboard" ||
    parsed.version !== 1 ||
    !parsed.room ||
    !Array.isArray(parsed.room.canvases) ||
    parsed.room.canvases.length === 0
  ) {
    throw new Error("Unsupported Mathboard import file");
  }

  return parsed as MathboardExportFile;
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
  const importInputRef = useRef<HTMLInputElement | null>(null);

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

    const socket = io(SOCKET_URL, {
      transports: ["polling", "websocket"],
      tryAllTransports: true
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
      setRemoteStrokes([]);
      setActiveCanvasId((current) => {
        if (shouldSelectCreatedCanvasRef.current) {
          shouldSelectCreatedCanvasRef.current = false;
          return snapshot.canvases.at(-1)?.id ?? current;
        }

        if (current && snapshot.canvases.some((canvas) => canvas.id === current)) {
          return current;
        }

        return snapshot.canvases[0]?.id ?? null;
      });
    });
    socket.on("room:operation:applied", (message: OperationAppliedMessage) => {
      setRoom((current) => applyBroadcastOperation(current, message));

      const operation = message.operation;
      if (operation.type === "stroke:add") {
        setRemoteStrokes((current) =>
          current.filter(
            (item) =>
              item.socketId !== message.socketId ||
              item.canvasId !== operation.canvasId ||
              item.stroke.id !== operation.stroke.id
          )
        );
      }
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
      setRemoteStrokes((current) => {
        const existingIndex = current.findIndex(
          (item) =>
            item.socketId === stroke.socketId &&
            item.canvasId === stroke.canvasId &&
            item.stroke.id === stroke.stroke.id
        );

        if (stroke.isStart || existingIndex === -1) {
          return [
            ...current.filter(
              (item) =>
                item.socketId !== stroke.socketId ||
                item.canvasId !== stroke.canvasId ||
                item.stroke.id !== stroke.stroke.id
            ),
            stroke
          ];
        }

        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                stroke: {
                  ...item.stroke,
                  points: [...item.stroke.points, ...stroke.stroke.points]
                }
              }
            : item
        );
      });
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
    (canvasId: string, stroke: Stroke, isStart: boolean) => {
      if (!roomId) {
        return;
      }

      socketRef.current?.emit("stroke:preview", {
        roomId,
        canvasId,
        stroke,
        isStart
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

  const exportRoom = useCallback(async () => {
    if (!room) {
      return;
    }

    const exportFile: MathboardExportFile = {
      app: "mathboard",
      version: 1,
      exportedAt: new Date().toISOString(),
      room: {
        canvases: await Promise.all(
          room.canvases.map(async (canvas) => ({
            id: canvas.id,
            title: canvas.title,
            strokes: canvas.strokes,
            images: await Promise.all(
              canvas.images.map(async (image) => ({
                ...image,
                src: await imageSourceToDataUrl(image.src)
              }))
            )
          }))
        )
      }
    };

    const blob = new Blob([JSON.stringify(exportFile, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mathboard-${room.id}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [room]);

  const openImportPicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const importRoomFile = useCallback(
    async (file: File) => {
      if (!roomId) {
        return;
      }

      const parsed = parseImportFile(await file.text());
      const importedSnapshot: ImportedRoomSnapshot = {
        canvases: await Promise.all(
          parsed.room.canvases.map(async (canvas) => ({
            id: canvas.id || crypto.randomUUID(),
            title: canvas.title || "Холст",
            strokes: canvas.strokes ?? [],
            images: await Promise.all(
              (canvas.images ?? []).map(async (image) => {
                if (image.src.startsWith("data:")) {
                  const uploadedImage = await uploadImage(image.src);
                  return {
                    ...image,
                    src: uploadedImage.src
                  };
                }

                return image;
              })
            )
          }))
        )
      };

      setRemoteCursors([]);
      setRemoteStrokes([]);
      const socket = socketRef.current;
      if (socket?.connected) {
        socket.emit("room:replace", { roomId, snapshot: importedSnapshot });
        return;
      }

      const snapshot = await importRoom(roomId, importedSnapshot);
      setRoom(snapshot);
      setActiveCanvasId(snapshot.canvases[0]?.id ?? null);
    },
    [roomId]
  );

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

      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        event.preventDefault();
        const direction = event.code === "BracketRight" ? 1 : -1;

        if (tool === "pen") {
          setBrushSize((current) =>
            clamp(current + direction, MIN_TOOL_SIZE, MAX_BRUSH_SIZE)
          );
        } else {
          setEraserSize((current) =>
            clamp(current + direction, MIN_TOOL_SIZE, MAX_ERASER_SIZE)
          );
        }

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
  }, [activeCanvas, emitOperation, tool]);

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
          void uploadImage(src).then((uploadedImage) => {
            const pastedImage: BoardImage = {
              id: crypto.randomUUID(),
              src: uploadedImage.src,
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
          <div>
            <h1>Mathboard</h1>
            <span className={styles.roomLine}>/r/{roomId}</span>
          </div>
          <div className={styles.identityActions}>
            <button
              className={styles.copyButton}
              onClick={copyLink}
              type="button"
              aria-label="Скопировать ссылку"
              title="Copy link"
            >
              <Copy size={16} />
            </button>
            <button
              className={styles.copyButton}
              onClick={openImportPicker}
              type="button"
              aria-label="Импортировать JSON"
              title="Import"
            >
              <Upload size={16} />
            </button>
            <button
              className={styles.copyButton}
              onClick={exportRoom}
              disabled={!room}
              type="button"
              aria-label="Экспортировать JSON"
              title="Export"
            >
              <Download size={16} />
            </button>
          </div>
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
              min={MIN_TOOL_SIZE}
              max={tool === "pen" ? MAX_BRUSH_SIZE : MAX_ERASER_SIZE}
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
              title="Назад"
            >
              <Undo2 size={17} />
            </Toolbar.Button>
            <Toolbar.Button
              className={styles.actionButton}
              onClick={() =>
                activeCanvas && emitOperation({ type: "history:redo", canvasId: activeCanvas.id })
              }
              disabled={!activeCanvas?.canRedo}
              aria-label="Вернуть"
              title="Вперед"
            >
              <Redo2 size={17} />
            </Toolbar.Button>
            <Toolbar.Button
              className={styles.actionButton}
              onClick={clearCanvas}
              disabled={!activeCanvas || (activeCanvas.strokes.length === 0 && activeCanvas.images.length === 0)}
              aria-label="Очистить холст"
              title="Очистить холст"
            >
              <Trash2 size={17} />
            </Toolbar.Button>
          </div>

        </Toolbar.Root>

        <input
          ref={importInputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) {
              void importRoomFile(file);
            }
          }}
        />

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
            localCursorName={profile.name}
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
    operation.type !== "image:delete" &&
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

      if (operation.type === "image:delete") {
        return {
          ...canvas,
          images: canvas.images.filter((image) => image.id !== operation.image.id),
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

function applyBroadcastOperation(
  room: RoomSnapshot | null,
  message: OperationAppliedMessage
): RoomSnapshot | null {
  const operation = message.operation;
  if (!room) {
    return room;
  }

  return {
    ...room,
    updatedAt: message.updatedAt,
    canvases: room.canvases.map((canvas) => {
      if (canvas.id !== operation.canvasId) {
        return canvas;
      }

      const nextCanvas = {
        ...canvas,
        canUndo: message.canvas.canUndo,
        canRedo: message.canvas.canRedo
      };

      if (operation.type === "stroke:add") {
        return {
          ...nextCanvas,
          strokes: nextCanvas.strokes.some((stroke) => stroke.id === operation.stroke.id)
            ? nextCanvas.strokes
            : [...nextCanvas.strokes, operation.stroke]
        };
      }

      if (operation.type === "image:add") {
        return {
          ...nextCanvas,
          images: nextCanvas.images.some((image) => image.id === operation.image.id)
            ? nextCanvas.images
            : [...nextCanvas.images, operation.image]
        };
      }

      if (operation.type === "image:delete") {
        return {
          ...nextCanvas,
          images: nextCanvas.images.filter((image) => image.id !== operation.image.id)
        };
      }

      if (operation.type === "canvas:clear") {
        return {
          ...nextCanvas,
          strokes: [],
          images: []
        };
      }

      return {
        ...nextCanvas,
        images: nextCanvas.images.map((image) =>
          image.id === operation.after.id ? operation.after : image
        )
      };
    })
  };
}
