// NMFC freight class from density (lb per cubic foot) — the same table the backend pricing
// engine uses (backend/src/services/pricingEngine.service.js), so the class shown on the
// quote form matches what the backend would calculate.
const FREIGHT_CLASS_TABLE = [
  [50, 50], [35, 55], [30, 60], [22.5, 65], [15, 70], [13.5, 77.5], [12, 85], [10.5, 92.5],
  [9, 100], [8, 110], [7, 125], [6, 150], [5, 175], [4, 200], [3, 250], [2, 300], [1, 400],
];

export const FREIGHT_CLASSES = ['50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500'];

// weight = total shipment weight (lb); length/width/height = per piece (in).
export function estimateFreightClass({ weight, pieces, length, width, height }) {
  const w = Number(weight), l = Number(length), wd = Number(width), h = Number(height);
  const n = Math.max(1, Number(pieces) || 1);
  if (!(w > 0 && l > 0 && wd > 0 && h > 0)) return null;
  const density = w / ((l * wd * h * n) / 1728);
  const row = FREIGHT_CLASS_TABLE.find(([min]) => density >= min);
  return { density: Math.round(density * 10) / 10, freightClass: String(row ? row[1] : 500) };
}
