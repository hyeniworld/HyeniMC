import React from 'react';

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-500"
      />
      <span className="w-16 text-right text-sm text-gray-300">
        {value}{suffix || ''}
      </span>
    </div>
  );
}
