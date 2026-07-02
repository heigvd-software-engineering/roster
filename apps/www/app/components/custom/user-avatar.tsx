import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

/** First+last initials, e.g. "Stefan Teofanovic" → "ST". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join("");
  return (letters || name.charAt(0) || "?").toUpperCase();
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
