const SPAIN_PATH =
  "M 30 80 Q 50 60 90 65 Q 130 55 170 60 Q 210 50 250 65 Q 280 75 290 100 Q 295 130 270 150 Q 240 165 200 160 Q 160 170 120 165 Q 80 170 50 155 Q 25 135 30 105 Z";

export function SpainWatermark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 200"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={SPAIN_PATH} />
      {[0.7, 0.55, 0.4].map((s, i) => (
        <path
          key={i}
          d={SPAIN_PATH}
          strokeOpacity={0.5}
          transform={`translate(${160 * (1 - s)} ${100 * (1 - s)}) scale(${s})`}
        />
      ))}
    </svg>
  );
}
