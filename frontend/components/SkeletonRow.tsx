"use client";

interface Props {
  height?: string | number;
  width?: string | number;
  style?: React.CSSProperties;
}

/** Single skeleton loading placeholder. For lists, render multiple in a loop. */
export default function SkeletonRow({ height = "80px", width, style }: Props) {
  return (
    <div
      className="ui-skeleton"
      style={{ height, width, ...style }}
    />
  );
}
