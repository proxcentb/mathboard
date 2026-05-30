import * as Toolbar from "@radix-ui/react-toolbar";
import {
  ArrowDown,
  ArrowUp,
  Brush,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  LogIn,
  Plus,
  RefreshCw,
  Redo2,
  Trash2,
  Undo2,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, Socket } from "socket.io-client";
import {
  SOCKET_URL,
  createRoom,
  deleteAdminRoom,
  getAdminSummary,
  getRoom,
  imageUrl,
  importRoom,
  uploadImage
} from "./api";
import styles from "./App.module.css";
import { BoardCanvas } from "./components/BoardCanvas";
import { CanvasPreview } from "./components/CanvasPreview";
import { listVisibleCursorAvatars, resolveCursorAvatarSrc } from "./cursorAssets";
import {
  BoardImage,
  BoardOperation,
  AdminSummary,
  CanvasSnapshotMessage,
  DrawingTool,
  HistoryStateMessage,
  ImportedRoomSnapshot,
  MathboardExportFile,
  OperationAppliedMessage,
  ParticipantAvatar,
  ParticipantProfile,
  Point,
  RemoteCursor,
  RemoteCursorEvent,
  RemoteCursorPosition,
  RemoteCursorProfile,
  RemoteCursorStore,
  RemoteStroke,
  RoomRoleMessage,
  RoomSnapshot,
  Stroke
} from "./types";

const DEFAULT_PROFILE: ParticipantProfile = {
  slot: 0,
  name: "🦊",
  color: "#1d4ed8"
};
const PROFILE_EMOJIS = ["🦊", "🐼", "🐸", "🐯", "🐨", "🐰", "🐧", "🐙", "🦉", "🦁", "🐢", "🐳"];
const PROFILE_CHOICES = [
  ...PROFILE_EMOJIS.map((emoji) => ({
    id: emoji,
    name: emoji,
    avatar: {
      type: "emoji",
      value: emoji
    } satisfies ParticipantAvatar
  })),
  ...listVisibleCursorAvatars().map((avatar) => ({
    id: `cursor:${avatar.type === "image" ? avatar.name : avatar.value}`,
    name: avatar.type === "image" ? avatar.name : avatar.value,
    avatar
  }))
];
const MIN_TOOL_SIZE = 1;
const MAX_BRUSH_SIZE = 48;
const MAX_ERASER_SIZE = 120;
const USER_ID_STORAGE_KEY = "mathboard-user-id";

interface RoomPreferences {
  cursorName: string;
  cursorAvatar?: ParticipantAvatar;
  color: string;
  tool: DrawingTool;
  brushSize: number;
  eraserSize: number;
}

const DEFAULT_ROOM_PREFERENCES: RoomPreferences = {
  cursorName: DEFAULT_PROFILE.name,
  color: DEFAULT_PROFILE.color,
  tool: "pen",
  brushSize: 1,
  eraserSize: 50
};

function currentRoomId(): string | null {
  const match = window.location.pathname.match(/^\/r\/([^/]+)(?:\/c\/([^/]+))?\/?$/);
  return match?.[1] ?? null;
}

function currentCanvasId(): string | null {
  const match = window.location.pathname.match(/^\/r\/([^/]+)(?:\/c\/([^/]+))?\/?$/);
  return match?.[2] ?? null;
}

function currentPath(): string {
  return window.location.pathname;
}

function roomCanvasPath(roomId: string, canvasId: string): string {
  return `/r/${encodeURIComponent(roomId)}/c/${encodeURIComponent(canvasId)}`;
}

function getOrCreateUserId(): string {
  const existing = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const userId = crypto.randomUUID();
  localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  return userId;
}

function roomPreferencesStorageKey(userId: string, roomId: string): string {
  return `mathboard-user:${userId}:room:${roomId}:preferences`;
}

function readRoomPreferences(userId: string, roomId: string | null): RoomPreferences | null {
  if (!roomId) {
    return null;
  }

  const content = localStorage.getItem(roomPreferencesStorageKey(userId, roomId));
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as Partial<RoomPreferences>;
    return {
      cursorName:
        typeof parsed.cursorName === "string"
          ? parsed.cursorName
          : DEFAULT_ROOM_PREFERENCES.cursorName,
      cursorAvatar: isParticipantAvatar(parsed.cursorAvatar) ? parsed.cursorAvatar : undefined,
      color: typeof parsed.color === "string" ? parsed.color : DEFAULT_ROOM_PREFERENCES.color,
      tool: parsed.tool === "eraser" ? "eraser" : "pen",
      brushSize: clampNumber(parsed.brushSize, MIN_TOOL_SIZE, MAX_BRUSH_SIZE, 1),
      eraserSize: clampNumber(parsed.eraserSize, MIN_TOOL_SIZE, MAX_ERASER_SIZE, 50)
    };
  } catch {
    return null;
  }
}

function writeRoomPreferences(userId: string, roomId: string, preferences: RoomPreferences): void {
  localStorage.setItem(roomPreferencesStorageKey(userId, roomId), JSON.stringify(preferences));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function isParticipantAvatar(value: unknown): value is ParticipantAvatar {
  if (!value || typeof value !== "object") {
    return false;
  }

  const avatar = value as Partial<ParticipantAvatar>;
  return avatar.type === "emoji"
    ? typeof avatar.value === "string"
    : avatar.type === "image" && typeof avatar.name === "string";
}

function profileWithPreferences(
  profile: ParticipantProfile,
  preferences: RoomPreferences
): ParticipantProfile {
  return {
    ...profile,
    name: preferences.cursorName,
    avatar: preferences.cursorAvatar,
    color: preferences.color
  };
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

function profileAvatar(profile: ParticipantProfile): ParticipantAvatar {
  return (
    profile.avatar ?? {
      type: "emoji",
      value: profile.name
    }
  );
}

function avatarKey(avatar: ParticipantAvatar): string {
  return avatar.type === "emoji" ? `emoji:${avatar.value}` : `image:${avatar.name}`;
}

function renderAvatar(avatar: ParticipantAvatar, className?: string) {
  if (avatar.type === "emoji") {
    return avatar.value;
  }

  const src = resolveCursorAvatarSrc(avatar);
  if (!src) {
    return avatar.alt ?? avatar.name;
  }

  return <img className={className} src={src} alt={avatar.alt ?? avatar.name} draggable={false} />;
}

function localCursorImageSrc(avatar: ParticipantAvatar): string | undefined {
  if (avatar.type !== "image") {
    return undefined;
  }

  return resolveCursorAvatarSrc(avatar);
}

interface RemoteCursorController extends RemoteCursorStore {
  updatePosition: (position: RemoteCursorPosition) => void;
  updateProfile: (profile: RemoteCursorProfile) => void;
  removeProfile: (socketId: string) => void;
  leave: (socketId: string) => void;
  clear: () => void;
}

function createRemoteCursorController(): RemoteCursorController {
  const cursors = new Map<string, RemoteCursor>();
  const profiles = new Map<string, RemoteCursorProfile>();
  const listeners = new Set<(event: RemoteCursorEvent) => void>();

  function emit(event: RemoteCursorEvent) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  return {
    getSnapshot: () => Array.from(cursors.values()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updatePosition: (position) => {
      const profile = profiles.get(position.socketId);
      const cursor = {
        name: profile?.name ?? "?",
        color: profile?.color,
        avatar: profile?.avatar,
        ...position
      };
      cursors.set(cursor.socketId, cursor);
      emit({ type: "update", cursor });
    },
    updateProfile: (profile) => {
      profiles.set(profile.socketId, profile);
      const cursor = cursors.get(profile.socketId);
      if (!cursor) {
        return;
      }

      const updatedCursor = {
        ...cursor,
        name: profile.name,
        color: profile.color,
        avatar: profile.avatar
      };
      cursors.set(profile.socketId, updatedCursor);
      emit({ type: "update", cursor: updatedCursor });
    },
    leave: (socketId) => {
      if (!cursors.delete(socketId)) {
        return;
      }
      emit({ type: "leave", socketId });
    },
    removeProfile: (socketId) => {
      profiles.delete(socketId);
    },
    clear: () => {
      const socketIds = Array.from(cursors.keys());
      cursors.clear();
      profiles.clear();
      for (const socketId of socketIds) {
        emit({ type: "leave", socketId });
      }
    }
  };
}

export function App() {
  const [userId] = useState(getOrCreateUserId);
  const [path, setPath] = useState(() => currentPath());
  const [roomId, setRoomId] = useState(() => currentRoomId());
  const [initialPreferences] = useState(() => readRoomPreferences(userId, currentRoomId()));
  const initialProfile = initialPreferences
    ? profileWithPreferences(DEFAULT_PROFILE, initialPreferences)
    : DEFAULT_PROFILE;
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [adminRoomId, setAdminRoomId] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>(
    initialPreferences?.tool ?? DEFAULT_ROOM_PREFERENCES.tool
  );
  const [color, setColor] = useState(
    initialPreferences?.color ?? DEFAULT_ROOM_PREFERENCES.color
  );
  const [brushSize, setBrushSize] = useState(
    initialPreferences?.brushSize ?? DEFAULT_ROOM_PREFERENCES.brushSize
  );
  const [eraserSize, setEraserSize] = useState(
    initialPreferences?.eraserSize ?? DEFAULT_ROOM_PREFERENCES.eraserSize
  );
  const [activeCanvasId, setActiveCanvasId] = useState(() => currentCanvasId());
  const [remoteStrokes, setRemoteStrokes] = useState<RemoteStroke[]>([]);
  const [profile, setProfile] = useState<ParticipantProfile>(initialProfile);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [remoteCursorStore] = useState(createRemoteCursorController);
  const socketRef = useRef<Socket | null>(null);
  const shouldSelectCreatedCanvasRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const preferencesRoomIdRef = useRef<string | null>(null);
  const currentProfileAvatar = useMemo(() => profileAvatar(profile), [profile]);

  useEffect(() => {
    const onPopState = () => {
      setPath(currentPath());
      setRoomId(currentRoomId());
      setActiveCanvasId(currentCanvasId());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const isAdminRoute = path === "/admin";

  useEffect(() => {
    if (!roomId) {
      return;
    }

    let ignored = false;
    void getRoom(roomId).then((snapshot) => {
      if (!ignored) {
        setRoom(snapshot);
        setActiveCanvasId((current) =>
          snapshot.canvases.some((canvas) => canvas.id === current)
            ? current
            : snapshot.canvases[0]?.id ?? null
        );
      }
    });

    return () => {
      ignored = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !activeCanvasId) {
      return;
    }

    const nextPath = roomCanvasPath(roomId, activeCanvasId);
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, "", nextPath);
    }
  }, [activeCanvasId, roomId]);

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
      socket.emit("room:join", { roomId, userId });
    });
    socket.on("room:profile", (nextProfile: ParticipantProfile) => {
      const preferences = readRoomPreferences(userId, roomId);
      const restoredProfile = preferences
        ? profileWithPreferences(nextProfile, preferences)
        : nextProfile;
      preferencesRoomIdRef.current = roomId;
      setProfile(restoredProfile);
      setColor(restoredProfile.color);
      setTool(preferences?.tool ?? DEFAULT_ROOM_PREFERENCES.tool);
      setBrushSize(preferences?.brushSize ?? DEFAULT_ROOM_PREFERENCES.brushSize);
      setEraserSize(preferences?.eraserSize ?? DEFAULT_ROOM_PREFERENCES.eraserSize);

      if (preferences) {
        socket.emit("cursor:profile:update", {
          roomId,
          name: restoredProfile.name,
          color: restoredProfile.color,
          avatar: restoredProfile.avatar
        });
      }
    });
    socket.on("room:role", ({ isAdmin }: RoomRoleMessage) => {
      setAdminRoomId(isAdmin ? roomId : null);
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
    socket.on("room:canvas:snapshot", (message: CanvasSnapshotMessage) => {
      setRoom((current) => applyCanvasSnapshot(current, message));
    });
    socket.on("room:history:state", (message: HistoryStateMessage) => {
      setRoom((current) => applyHistoryState(current, message));
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
    socket.on("cursor:update", (position: RemoteCursorPosition) => {
      remoteCursorStore.updatePosition(position);
    });
    socket.on("cursor:profile:update", (nextProfile: RemoteCursorProfile) => {
      remoteCursorStore.updateProfile(nextProfile);
    });
    socket.on("cursor:leave", ({ socketId }: { socketId: string }) => {
      remoteCursorStore.leave(socketId);
    });
    socket.on("cursor:profile:leave", ({ socketId }: { socketId: string }) => {
      remoteCursorStore.removeProfile(socketId);
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
      if (preferencesRoomIdRef.current === roomId) {
        preferencesRoomIdRef.current = null;
      }
      remoteCursorStore.clear();
      setRemoteStrokes([]);
    };
  }, [remoteCursorStore, roomId, userId]);

  useEffect(() => {
    const preferencesRoomId = preferencesRoomIdRef.current;
    if (!preferencesRoomId) {
      return;
    }

    writeRoomPreferences(userId, preferencesRoomId, {
      cursorName: profile.name,
      cursorAvatar: profile.avatar,
      color,
      tool,
      brushSize,
      eraserSize
    });
  }, [brushSize, color, eraserSize, profile.avatar, profile.name, tool, userId]);

  const activeCanvas = useMemo(
    () => room?.canvases.find((canvas) => canvas.id === activeCanvasId) ?? room?.canvases[0],
    [activeCanvasId, room?.canvases]
  );
  const canManageCanvases = adminRoomId === roomId;

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
      socketRef.current?.emit("room:operation", { roomId, operation });
    },
    [roomId]
  );

  const openNewRoom = useCallback(async () => {
    const snapshot = await createRoom();
    const canvasId = snapshot.canvases[0]?.id ?? null;
    window.history.pushState(null, "", canvasId ? roomCanvasPath(snapshot.id, canvasId) : `/r/${snapshot.id}`);
    setPath(currentPath());
    setRoomId(snapshot.id);
    setRoom(snapshot);
    setActiveCanvasId(canvasId);
  }, []);

  const addCanvas = useCallback(() => {
    if (!roomId) {
      return;
    }

    shouldSelectCreatedCanvasRef.current = true;
    const operation: BoardOperation = { type: "canvas:create" };
    const socket = socketRef.current;

    socket?.emit("room:operation", { roomId, operation });
  }, [roomId]);

  const moveCanvas = useCallback(
    (canvasId: string, toIndex: number) => {
      if (!canManageCanvases) {
        return;
      }

      emitOperation({
        type: "canvas:move",
        canvasId,
        toIndex
      });
    },
    [canManageCanvases, emitOperation]
  );

  const deleteCanvas = useCallback(
    (canvasId: string) => {
      if (
        !canManageCanvases ||
        !room ||
        room.canvases.length === 1 ||
        !window.confirm("Удалить холст для всех участников?")
      ) {
        return;
      }

      emitOperation({
        type: "canvas:delete",
        canvasId
      });
    },
    [canManageCanvases, emitOperation, room]
  );

  const emitCursorMove = useCallback(
    (canvasId: string, point: Point) => {
      if (!roomId) {
        return;
      }

      socketRef.current?.emit("cursor:update", {
        roomId,
        canvasId,
        point
      });
    },
    [roomId]
  );

  const updateProfile = useCallback(
    (nextProfile: ParticipantProfile) => {
      setProfile(nextProfile);
      socketRef.current?.emit("cursor:profile:update", {
        roomId,
        name: nextProfile.name,
        color: nextProfile.color,
        avatar: nextProfile.avatar
      });
    },
    [roomId]
  );

  useEffect(() => {
    const input = colorInputRef.current;
    if (!input) {
      return;
    }

    const commitColor = () => {
      setColor(input.value);
      updateProfile({
        ...profile,
        color: input.value
      });
    };

    input.addEventListener("change", commitColor);
    return () => input.removeEventListener("change", commitColor);
  }, [profile, updateProfile]);

  useEffect(() => {
    if (colorInputRef.current) {
      colorInputRef.current.value = color;
    }
  }, [color]);

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
      canvasId: activeCanvas.id
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

      remoteCursorStore.clear();
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
    [remoteCursorStore, roomId]
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

      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) {
          setTool((current) => (current === "pen" ? "eraser" : "pen"));
        }
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
              id: uploadedImage.id,
              src: uploadedImage.src,
              x: 96,
              y: 96,
              width: Math.max(80, Math.round(image.naturalWidth * scale)),
              height: Math.max(80, Math.round(image.naturalHeight * scale))
            };

            emitOperation({
              type: "image:add",
              canvasId: activeCanvas.id,
              image: imagePlacement(pastedImage)
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

  if (isAdminRoute) {
    return <AdminScreen />;
  }

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
                {renderAvatar(currentProfileAvatar, styles.avatarImage)}
              </button>
              {isEmojiPickerOpen ? (
                <div className={styles.emojiPopover} role="menu">
                  <div className={styles.emojiGrid}>
                    {PROFILE_CHOICES.map((choice) => (
                      <button
                        key={choice.id}
                        className={styles.emojiChoice}
                        data-active={avatarKey(choice.avatar) === avatarKey(currentProfileAvatar)}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          updateProfile({
                            ...profile,
                            name: choice.name,
                            avatar: choice.avatar
                          });
                          setIsEmojiPickerOpen(false);
                        }}
                      >
                        {renderAvatar(choice.avatar, styles.avatarImage)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <label className={styles.colorControl} aria-label="Цвет кисти">
              <span>Цвет</span>
              <span className={styles.colorSwatch} style={{ backgroundColor: color }} />
              <input
                ref={colorInputRef}
                type="color"
                defaultValue={color}
              />
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
              <div key={canvas.id} className={styles.previewItem}>
                <button
                  className={styles.previewButton}
                  data-active={canvas.id === activeCanvas?.id}
                  onClick={() => setActiveCanvasId(canvas.id)}
                  type="button"
                >
                  <CanvasPreview canvas={canvas} />
                  <span>{index + 1}</span>
                </button>
                {canManageCanvases ? (
                  <div className={styles.previewActions}>
                    <button
                      className={styles.previewActionButton}
                      type="button"
                      onClick={() => moveCanvas(canvas.id, index - 1)}
                      disabled={index === 0}
                      aria-label={`Переместить холст ${index + 1} вверх`}
                      title="Переместить вверх"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className={styles.previewActionButton}
                      type="button"
                      onClick={() => moveCanvas(canvas.id, index + 1)}
                      disabled={index === room.canvases.length - 1}
                      aria-label={`Переместить холст ${index + 1} вниз`}
                      title="Переместить вниз"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      className={styles.previewActionButton}
                      data-danger="true"
                      type="button"
                      onClick={() => deleteCanvas(canvas.id)}
                      disabled={room.canvases.length === 1}
                      aria-label={`Удалить холст ${index + 1}`}
                      title="Удалить холст"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
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
            cursorStore={remoteCursorStore}
            remoteStrokes={activeCanvasRemoteStrokes}
            localCursorName={profile.name}
            localCursorAvatar={currentProfileAvatar}
            localCursorImageSrc={localCursorImageSrc(currentProfileAvatar)}
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

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let nextValue = value / 1024;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(value);
}

function AdminScreen() {
  const [password, setPassword] = useState(() => sessionStorage.getItem("mathboard-admin-password") ?? "");
  const [draftPassword, setDraftPassword] = useState("");
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!password) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      setSummary(await getAdminSummary(password));
    } catch {
      setError("Не удалось загрузить данные администратора");
    } finally {
      setIsLoading(false);
    }
  }, [password]);

  useEffect(() => {
    if (!password) {
      return;
    }

    void loadSummary();
    const interval = window.setInterval(() => {
      void loadSummary();
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [loadSummary, password]);

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sessionStorage.setItem("mathboard-admin-password", draftPassword);
    setPassword(draftPassword);
    setDraftPassword("");
  };

  const removeRoom = async (roomId: string) => {
    if (!window.confirm(`Удалить страницу ${roomId} из памяти приложения?`)) {
      return;
    }

    await deleteAdminRoom(roomId, password);
    await loadSummary();
  };

  if (!password) {
    return (
      <main className={styles.adminShell}>
        <form className={styles.adminLogin} onSubmit={submitPassword}>
          <h1>Admin</h1>
          <input
            type="password"
            value={draftPassword}
            onChange={(event) => setDraftPassword(event.target.value)}
            placeholder="Пароль"
            autoFocus
          />
          <button className={styles.primaryButton} type="submit" disabled={!draftPassword}>
            <LogIn size={18} aria-hidden />
            Войти
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className={styles.adminShell}>
      <section className={styles.adminHeader}>
        <div>
          <h1>Admin</h1>
          <p>{summary ? `Обновлено: ${formatDate(summary.generatedAt)}` : "Нет данных"}</p>
        </div>
        <div className={styles.adminActions}>
          <button className={styles.actionButton} onClick={() => void loadSummary()} disabled={isLoading}>
            <RefreshCw size={17} aria-hidden />
            Обновить
          </button>
          <button
            className={styles.actionButton}
            onClick={() => {
              sessionStorage.removeItem("mathboard-admin-password");
              setPassword("");
              setSummary(null);
            }}
          >
            Выйти
          </button>
        </div>
      </section>

      {error ? <p className={styles.adminError}>{error}</p> : null}

      {summary ? (
        <>
          <section className={styles.adminMetrics}>
            <div>
              <span>Страницы</span>
              <strong>{summary.totals.rooms}</strong>
            </div>
            <div>
              <span>Холсты</span>
              <strong>{summary.totals.canvases}</strong>
            </div>
            <div>
              <span>Линии</span>
              <strong>{summary.totals.strokes}</strong>
            </div>
            <div>
              <span>Картинки</span>
              <strong>{summary.totals.images}</strong>
            </div>
            <div>
              <span>Изображения в памяти</span>
              <strong>{formatBytes(summary.totals.storedImageBytes)}</strong>
            </div>
            <div>
              <span>RSS</span>
              <strong>{formatBytes(summary.process.memory.rss)}</strong>
            </div>
            <div>
              <span>Heap</span>
              <strong>{formatBytes(summary.process.memory.heapUsed)}</strong>
            </div>
            <div>
              <span>CPU</span>
              <strong>
                {summary.process.cpu.percent === null
                  ? "сбор данных"
                  : `${summary.process.cpu.percent.toFixed(1)}%`}
              </strong>
            </div>
          </section>

          <section className={styles.adminTableWrap}>
            <table className={styles.adminTable}>
              <thead>
                <tr>
                  <th>Страница</th>
                  <th>Обновлена</th>
                  <th>Холсты</th>
                  <th>Линии</th>
                  <th>Картинки</th>
                  <th>История</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.rooms.map((room) => (
                  <tr key={room.id}>
                    <td>
                      <a href={`/r/${room.id}`} target="_blank" rel="noreferrer">
                        /r/{room.id}
                        <ExternalLink size={14} aria-hidden />
                      </a>
                    </td>
                    <td>{formatDate(room.updatedAt)}</td>
                    <td>{room.canvasCount}</td>
                    <td>{room.strokeCount}</td>
                    <td>{room.imageCount}</td>
                    <td>{room.operationCount}</td>
                    <td>
                      <button className={styles.dangerButton} onClick={() => void removeRoom(room.id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
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
          images: [...canvas.images, boardImage(operation.image)],
          canUndo: true,
          canRedo: false
        };
      }

      if (operation.type === "image:delete") {
        return {
          ...canvas,
          images: canvas.images.filter((image) => image.id !== operation.imageId),
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
          image.id === operation.image.id ? { ...image, ...operation.image } : image
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

      const nextCanvas = canvas;

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
            : [...nextCanvas.images, boardImage(operation.image)]
        };
      }

      if (operation.type === "image:delete") {
        return {
          ...nextCanvas,
          images: nextCanvas.images.filter((image) => image.id !== operation.imageId)
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
          image.id === operation.image.id ? { ...image, ...operation.image } : image
        )
      };
    })
  };
}

function applyCanvasSnapshot(
  room: RoomSnapshot | null,
  message: CanvasSnapshotMessage
): RoomSnapshot | null {
  if (!room) {
    return room;
  }

  return {
    ...room,
    updatedAt: message.updatedAt,
    canvases: room.canvases.map((canvas) =>
      canvas.id === message.canvas.id
        ? {
            ...canvas,
            ...message.canvas,
            canUndo: message.canvas.canUndo ?? canvas.canUndo,
            canRedo: message.canvas.canRedo ?? canvas.canRedo
          }
        : canvas
    )
  };
}

function applyHistoryState(
  room: RoomSnapshot | null,
  message: HistoryStateMessage
): RoomSnapshot | null {
  if (!room) {
    return room;
  }

  return {
    ...room,
    canvases: room.canvases.map((canvas) =>
      canvas.id === message.canvasId
        ? {
            ...canvas,
            canUndo: message.canUndo,
            canRedo: message.canRedo
          }
        : canvas
    )
  };
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

function boardImage(image: ReturnType<typeof imagePlacement>): BoardImage {
  return {
    ...image,
    src: imageUrl(image.id)
  };
}
