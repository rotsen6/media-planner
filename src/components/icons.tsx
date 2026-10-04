import type { CSSProperties } from "react";

const paths = {
  sidebar: "M9 4v16M4 4h16v16H4z",
  compose: "m14 5 5 5M4 20l4-1 12-12-5-5L3 14l1 6ZM11 4H4v6M14 20h6v-7",
  close: "m6 6 12 12M6 18 18 6",
  send: "M12 19V5m-6 6 6-6 6 6",
  stop: "M6 6h12v12H6z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  search: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6",
} as const;
export function Icon({
  name,
  style,
}: {
  name: keyof typeof paths;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
