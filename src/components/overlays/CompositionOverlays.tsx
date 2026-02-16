import React from 'react';
import type { OverlayMode } from '../panel/right/CropPanel';

interface CompositionOverlaysProps {
  width: number;
  height: number;
  mode: OverlayMode;
  rotation: number;
  color?: string;
  opacity?: number;
}

export default function CompositionOverlays(
  {
    width,
    height,
    mode,
    rotation,
    color = 'rgba(255, 255, 255, 0.8)',
    opacity = 0.8,
  }: CompositionOverlaysProps) {
  if (mode === 'none' || width <= 0 || height <= 0) return null;

  const strokeProps = {
    stroke: color,
    strokeWidth: '1.5',
    fill: 'none',
    vectorEffect: 'non-scaling-stroke',
    style: { opacity },
  };

  const renderThirds = () => (
    <>
      <line x1={width * 0.333} y1={0} x2={width * 0.333} y2={height} {...strokeProps} />
      <line x1={width * 0.666} y1={0} x2={width * 0.666} y2={height} {...strokeProps} />
      <line x1={0} y1={height * 0.333} x2={width} y2={height * 0.333} {...strokeProps} />
      <line x1={0} y1={height * 0.666} x2={width} y2={height * 0.666} {...strokeProps} />
    </>
  );

  const renderPhiGrid = () => {
    const p1 = 0.382;
    const p2 = 0.618;
    return (
      <>
        <line x1={width * p1} y1={0} x2={width * p1} y2={height} {...strokeProps} />
        <line x1={width * p2} y1={0} x2={width * p2} y2={height} {...strokeProps} />
        <line x1={0} y1={height * p1} x2={width} y2={height * p1} {...strokeProps} />
        <line x1={0} y1={height * p2} x2={width} y2={height * p2} {...strokeProps} />
      </>
    );
  };

  const renderGoldenTriangle = () => {
    const r = rotation % 4;

    let mainStart = { x: 0, y: height };
    let mainEnd = { x: width, y: 0 };
    let recipStart = { x: 0, y: 0 };

    if (r === 1) {
      mainStart = { x: 0, y: 0 };
      mainEnd = { x: width, y: height };
      recipStart = { x: width, y: 0 };
    } else if (r === 2) {
      mainStart = { x: width, y: 0 };
      mainEnd = { x: 0, y: height };
      recipStart = { x: width, y: height };
    } else if (r === 3) {
      mainStart = { x: width, y: height };
      mainEnd = { x: 0, y: 0 };
      recipStart = { x: 0, y: height };
    }

    const dx = mainEnd.x - mainStart.x;
    const dy = mainEnd.y - mainStart.y;

    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;

    const m1 = dy / dx;
    const m2 = -1 / m1;

    const x_int = (m1 * mainStart.x - mainStart.y - m2 * recipStart.x + recipStart.y) / (m1 - m2);
    const y_int = m1 * (x_int - mainStart.x) + mainStart.y;

    const recipStart2 = { x: Math.abs(width - recipStart.x), y: Math.abs(height - recipStart.y) };
    const x_int2 = (m1 * mainStart.x - mainStart.y - m2 * recipStart2.x + recipStart2.y) / (m1 - m2);
    const y_int2 = m1 * (x_int2 - mainStart.x) + mainStart.y;

    return (
      <>
        <line x1={mainStart.x} y1={mainStart.y} x2={mainEnd.x} y2={mainEnd.y} {...strokeProps} />
        <line x1={recipStart.x} y1={recipStart.y} x2={x_int} y2={y_int} {...strokeProps} />
        <line x1={recipStart2.x} y1={recipStart2.y} x2={x_int2} y2={y_int2} {...strokeProps} />
      </>
    );
  };

  const renderHarmonicArmature = () => {
    const d1 = <line key="d1" x1={0} y1={0} x2={width} y2={height} {...strokeProps} />;
    const d2 = <line key="d2" x1={width} y1={0} x2={0} y2={height} {...strokeProps} />;

    const renderExtendedRecip = (
      sx: number, sy: number,
      ex: number, ey: number,
      px: number, py: number,
      key: string
    ) => {
      const dx = ex - sx;
      const dy = ey - sy;

      if (dx === 0 || dy === 0) return null;

      const mDiagonal = dy / dx;
      const mRecip = -1 / mDiagonal;

      let targetX: number;
      let targetY: number;

      targetX = px === 0 ? width : 0;
      targetY = mRecip * (targetX - px) + py;

      if (targetY < 0) {
        targetY = 0;
        targetX = (targetY - py) / mRecip + px;
      } else if (targetY > height) {
        targetY = height;
        targetX = (targetY - py) / mRecip + px;
      }

      return <line key={key} x1={px} y1={py} x2={targetX} y2={targetY} {...strokeProps} />;
    };

    return (
      <>
        {d1} {d2}
        {renderExtendedRecip(0, 0, width, height, width, 0, 'r1')}
        {renderExtendedRecip(0, 0, width, height, 0, height, 'r2')}
        {renderExtendedRecip(width, 0, 0, height, 0, 0, 'r3')}
        {renderExtendedRecip(width, 0, 0, height, width, height, 'r4')}
      </>
    );
  };

  const renderGoldenSpiral = () => {
    const r = rotation % 4;
    const isOddRotation = r === 1 || r === 3;
    const PHI = (1 + Math.sqrt(5)) / 2;

    const baseW = 1000;
    const baseH = baseW / PHI;

    const scaleX = (isOddRotation ? height : width) / baseW;
    const scaleY = (isOddRotation ? width : height) / baseH;

    const pathData = [
      "M 0 618.03",
      "A 618.03 618.03 0 0 1 618.03 0",
      "A 381.97 381.97 0 0 1 1000 381.97",
      "A 236.06 236.06 0 0 1 763.94 618.03",
      "A 145.91 145.91 0 0 1 618.03 472.12",
      "A 90.15 90.15 0 0 1 708.18 381.97",
      "A 55.76 55.76 0 0 1 763.94 437.73",
      "A 34.39 34.39 0 0 1 729.55 472.12",
      "A 21.37 21.37 0 0 1 708.18 450.75"
    ].join(" ");

    const transform = `
    rotate(${r * 90} ${width / 2} ${height / 2}) 
    translate(${(width - (isOddRotation ? height : width)) / 2} ${(height - (isOddRotation ? width : height)) / 2})
    scale(${scaleX}, ${scaleY})
  `;

    return (
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        transform={transform}
        style={{ opacity }}
      />
    );
  };

  return (
    <svg
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {mode === 'thirds' && renderThirds()}
      {mode === 'phiGrid' && renderPhiGrid()}
      {mode === 'goldenTriangle' && renderGoldenTriangle()}
      {mode === 'goldenSpiral' && renderGoldenSpiral()}
      {mode === '1_5_rectangle' && renderHarmonicArmature()}
    </svg>
  );
}