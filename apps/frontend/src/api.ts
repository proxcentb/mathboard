import { AdminSummary, BoardOperation, ImportedRoomSnapshot, RoomSnapshot } from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "/api";
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "";

function apiPath(path: string): string {
  return `${API_URL.replace(/\/$/, "")}${path}`;
}

export function imageUrl(id: string): string {
  return apiPath(`/images/${encodeURIComponent(id)}`);
}

export async function createRoom(): Promise<RoomSnapshot> {
  const response = await fetch(apiPath("/rooms"), {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Could not create room");
  }

  return response.json() as Promise<RoomSnapshot>;
}

export async function getRoom(id: string): Promise<RoomSnapshot> {
  const response = await fetch(apiPath(`/rooms/${id}`));

  if (!response.ok) {
    throw new Error("Could not load room");
  }

  return response.json() as Promise<RoomSnapshot>;
}

export async function sendOperation(roomId: string, operation: BoardOperation): Promise<RoomSnapshot> {
  const response = await fetch(apiPath(`/rooms/${roomId}/operations`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ operation })
  });

  if (!response.ok) {
    throw new Error("Could not apply operation");
  }

  return response.json() as Promise<RoomSnapshot>;
}

export async function importRoom(roomId: string, snapshot: ImportedRoomSnapshot): Promise<RoomSnapshot> {
  const response = await fetch(apiPath(`/rooms/${roomId}/import`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(snapshot)
  });

  if (!response.ok) {
    throw new Error("Could not import room");
  }

  return response.json() as Promise<RoomSnapshot>;
}

export async function uploadImage(dataUrl: string): Promise<{ id: string; src: string }> {
  const response = await fetch(apiPath("/images"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ dataUrl })
  });

  if (!response.ok) {
    throw new Error("Could not upload image");
  }

  const { id } = (await response.json()) as { id: string };
  return {
    id,
    src: imageUrl(id)
  };
}

export async function getAdminSummary(password: string): Promise<AdminSummary> {
  const response = await fetch(apiPath("/admin/summary"), {
    headers: {
      "X-Admin-Password": password
    }
  });

  if (!response.ok) {
    throw new Error("Could not load admin summary");
  }

  return response.json() as Promise<AdminSummary>;
}

export async function deleteAdminRoom(id: string, password: string): Promise<void> {
  const response = await fetch(apiPath(`/admin/rooms/${id}`), {
    method: "DELETE",
    headers: {
      "X-Admin-Password": password
    }
  });

  if (!response.ok) {
    throw new Error("Could not delete room");
  }
}
