import type { ParticipantAvatar } from "./types";

const cursorAssetModules = import.meta.glob("./assets/cursors/*.svg", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

const HIDDEN_CURSOR_ASSETS = new Set(["murka"]);

export const cursorAssetUrls = Object.fromEntries(
  Object.entries(cursorAssetModules).map(([path, src]) => [assetNameFromPath(path), src])
);

export function createCursorAvatar(name: string): ParticipantAvatar | null {
  const src = cursorAssetUrls[name];
  if (!src) {
    return null;
  }

  return {
    type: "image",
    name,
    alt: readableCursorName(name)
  };
}

export function listVisibleCursorAvatars(): ParticipantAvatar[] {
  return Object.keys(cursorAssetUrls)
    .filter((name) => !HIDDEN_CURSOR_ASSETS.has(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => createCursorAvatar(name))
    .filter((avatar): avatar is ParticipantAvatar => avatar !== null);
}

export function resolveCursorAvatarSrc(avatar: ParticipantAvatar): string | undefined {
  if (avatar.type !== "image") {
    return undefined;
  }

  return avatar.src ?? cursorAssetUrls[avatar.name];
}

function assetNameFromPath(path: string): string {
  return path
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "") ?? path;
}

function readableCursorName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
