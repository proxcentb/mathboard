import type { ParticipantAvatar } from "./types";

type EmojiAvatar = Extract<ParticipantAvatar, { type: "emoji" }>;

const cursorAssetModules = import.meta.glob("./assets/cursors/*.svg", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

export const DEFAULT_AVATAR_ID = "fox";

const EMOJI_AVATARS: EmojiAvatar[] = [
  { type: "emoji", id: "fox", value: "🦊", label: "Fox" },
  { type: "emoji", id: "panda", value: "🐼", label: "Panda" },
  { type: "emoji", id: "frog", value: "🐸", label: "Frog" },
  { type: "emoji", id: "tiger", value: "🐯", label: "Tiger" },
  { type: "emoji", id: "koala", value: "🐨", label: "Koala" },
  { type: "emoji", id: "rabbit", value: "🐰", label: "Rabbit" },
  { type: "emoji", id: "penguin", value: "🐧", label: "Penguin" },
  { type: "emoji", id: "octopus", value: "🐙", label: "Octopus" },
  { type: "emoji", id: "owl", value: "🦉", label: "Owl" },
  { type: "emoji", id: "lion", value: "🦁", label: "Lion" },
  { type: "emoji", id: "turtle", value: "🐢", label: "Turtle" },
  { type: "emoji", id: "whale", value: "🐳", label: "Whale" }
];

const CURSOR_ASSET_CONFIG: Record<string, Pick<Extract<ParticipantAvatar, { type: "image" }>, "cursorScale">> = {
  pachicha: {
    cursorScale: 2
  }
};

export const cursorAssetUrls = Object.fromEntries(
  Object.entries(cursorAssetModules).map(([path, src]) => [assetNameFromPath(path), src])
);

export interface CursorAvatarChoice {
  id: string;
  label: string;
  avatar: ParticipantAvatar;
}

export function createCursorAvatar(name: string): ParticipantAvatar | null {
  const src = cursorAssetUrls[name];
  if (!src) {
    return null;
  }

  return {
    type: "image",
    id: name,
    name,
    alt: readableCursorName(name),
    ...CURSOR_ASSET_CONFIG[name]
  };
}

export function listCursorAvatarChoices(): CursorAvatarChoice[] {
  const imageChoices = Object.keys(cursorAssetUrls)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => createCursorAvatar(name))
    .filter((avatar): avatar is ParticipantAvatar => avatar !== null)
    .map((avatar) => ({
      id: avatar.id,
      label: avatar.type === "image" ? avatar.alt ?? avatar.name : avatar.label,
      avatar
    }));

  return [
    ...EMOJI_AVATARS.map((avatar) => ({
      id: avatar.id,
      label: avatar.label,
      avatar
    })),
    ...imageChoices
  ];
}

export function resolveParticipantAvatar(avatarId?: string): ParticipantAvatar {
  return avatarById.get(normalizeParticipantAvatarId(avatarId) ?? DEFAULT_AVATAR_ID)!;
}

export function normalizeParticipantAvatarId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (avatarById.has(value)) {
    return value;
  }

  return emojiAvatarIdByValue.get(value) ?? null;
}

export function resolveCursorAvatarSrc(avatar: ParticipantAvatar): string | undefined {
  if (avatar.type !== "image") {
    return undefined;
  }

  return avatar.src ?? cursorAssetUrls[avatar.name];
}

const avatarById = new Map(
  listCursorAvatarChoices().map((choice) => [choice.id, choice.avatar])
);

const emojiAvatarIdByValue = new Map(EMOJI_AVATARS.map((avatar) => [avatar.value, avatar.id]));

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
