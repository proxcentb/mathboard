import { BoardOperation, RoomSnapshot } from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "/api";
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "";

export async function createRoom(): Promise<RoomSnapshot> {
  const response = await fetch(`${API_URL}/rooms`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Could not create room");
  }

  return response.json() as Promise<RoomSnapshot>;
}

export async function getRoom(id: string): Promise<RoomSnapshot> {
  const response = await fetch(`${API_URL}/rooms/${id}`);

  if (!response.ok) {
    throw new Error("Could not load room");
  }

  return response.json() as Promise<RoomSnapshot>;
}

export async function sendOperation(roomId: string, operation: BoardOperation): Promise<RoomSnapshot> {
  const response = await fetch(`${API_URL}/rooms/${roomId}/operations`, {
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
