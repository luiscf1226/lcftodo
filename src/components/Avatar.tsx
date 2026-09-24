/* eslint-disable @next/next/no-img-element */
import type { Member } from "./useMembers";

export function Avatar({ member, size = 20 }: { member?: Member; size?: number }) {
  if (!member) return null;
  const style = { width: size, height: size };
  if (member.imageUrl) {
    return <img src={member.imageUrl} alt={member.name} title={member.name} style={style} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      title={member.name}
      style={{ ...style, fontSize: size * 0.45 }}
      className="grid shrink-0 place-items-center rounded-full bg-surface-2 font-medium text-muted"
    >
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
