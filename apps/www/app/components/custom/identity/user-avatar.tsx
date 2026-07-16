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
  src?: string | null | undefined;
  size?: "sm" | "default" | "lg";
  /** People are circles; organizations are rounded squares (GitHub's own
   *  convention, and the class-card mockup's). */
  shape?: "circle" | "square";
};

/** Avatar: the image if present, initials fallback otherwise. */
export function UserAvatar({
  name,
  src,
  size = "default",
  shape = "circle",
}: UserAvatarProps) {
  const square = shape === "square";
  return (
    <Avatar
      size={size}
      className={square ? "rounded-md after:rounded-md" : undefined}
    >
      {src ? (
        <AvatarImage
          src={src}
          alt={name}
          className={square ? "rounded-md" : undefined}
        />
      ) : null}
      <AvatarFallback className={square ? "rounded-md" : undefined}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
