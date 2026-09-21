export const CARRIERS = [
  { id: 'fedex', name: 'FedEx', abbr: 'FX', bg: '#eff4ff', color: '#1a56db', bc: '#c7d7fd' },
  { id: 'xpo', name: 'XPO Logistics', abbr: 'XPO', bg: '#fdf2f2', color: '#c81e1e', bc: '#fbd5d5' },
  { id: 'dayross', name: 'Day & Ross', abbr: 'D&R', bg: '#eff4ff', color: '#1e429f', bc: '#c7d7fd' },
  { id: 'manitoulin', name: 'Manitoulin', abbr: 'MAN', bg: '#edfaf4', color: '#057a55', bc: '#a7f3d0' },
  { id: 'polaris', name: 'Polaris', abbr: 'POL', bg: '#f5f3ff', color: '#5521b5', bc: '#ddd6fe' },
  { id: 'dhl', name: 'DHL Express', abbr: 'DHL', bg: '#fef9c3', color: '#d4002a', bc: '#fde68a' },
  { id: 'csa', name: 'CSA Transportation', abbr: 'CSA', bg: '#e8f0fe', color: '#003d7a', bc: '#a8c7fa' },
];

export function getCarrier(id) {
  return CARRIERS.find(c => c.id === id);
}
