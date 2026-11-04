import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/** Code 128 barcode as SVG (prints crisply on labels and library cards). */
export function Barcode({ value, height = 40, width = 1.6, fontSize = 12, displayValue = true }: { value: string; height?: number; width?: number; fontSize?: number; displayValue?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, displayValue, margin: 0, background: 'transparent' });
    } catch {
      // Characters Code 128 cannot encode: leave the SVG empty rather than crash the page.
    }
  }, [value, height, width, fontSize, displayValue]);
  return <svg ref={ref} aria-label={`Barcode ${value}`} />;
}
