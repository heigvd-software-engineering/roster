import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

/**
 * First+last initials, e.g. "Stefan Teofanovic" → "ST". Falls back to "?" when
 * the name has no visible characters (e.g. whitespace-only) — exported as a
 * pure helper so it's unit-testable without rendering.
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join("");
  return (letters || trimmed.charAt(0) || "?").toUpperCase();
}

type UserAvatarProps = {
  name: string;
  src?: string | null;
  size?: "sm" | "default" | "lg";
};

/** Round avatar: the image if present, initials fallback otherwise. */
export function UserAvatar({ name, src, size = "default" }: UserAvatarProps) {
  return (
    <Avatar size={size}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
