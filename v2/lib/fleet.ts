export const categories = ['LV', 'DT', 'ADT', 'Service Truck', 'Lowbed'] as const;
export const sites = ['Abore Pit', 'Esaase Pit', 'Other'] as const;
export const operatingStatuses = ['Active', 'Grounded', 'Under Maintenance'] as const;
export type Role = 'Admin' | 'Editor' | 'Viewer';
export type Profile = { id: string; full_name: string; role: Role; site: string | null };
export type Vehicle = {
  id: string;
  plate_number: string;
  category: string;
  make_model: string;
  site: string;
  status: string;
  roadworthy_cert_no: string;
  roadworthy_issue_date: string | null;
  roadworthy_expiry_date: string | null;
  insurance_provider: string;
  insurance_policy_no: string;
  insurance_expiry_date: string | null;
  document_urls: string[];
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};
export type Audit = { id: string; vehicle_id: string; changed_by: string | null; change_summary: string; changed_at: string };
export type VehicleDraft = Omit<Vehicle, 'id' | 'created_at' | 'updated_at' | 'updated_by'>;
export const blankVehicle: VehicleDraft = {
  plate_number: '', category: 'LV', make_model: '', site: 'Abore Pit', status: 'Active',
  roadworthy_cert_no: '', roadworthy_issue_date: null, roadworthy_expiry_date: null,
  insurance_provider: '', insurance_policy_no: '', insurance_expiry_date: null, document_urls: [],
};
export function daysUntil(value: string | null, now = new Date()) {
  if (!value) return null;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(value + 'T00:00:00Z') - start) / 86400000);
}
export function expiryStatus(value: string | null) {
  const days = daysUntil(value);
  return days === null ? 'Missing' : days < 0 ? 'Expired' : days <= 30 ? 'Due soon' : 'Current';
}
export function nearestExpiry(vehicle: Vehicle) {
  const dates = [vehicle.roadworthy_expiry_date, vehicle.insurance_expiry_date].filter((date): date is string => !!date);
  return dates.length ? dates.sort()[0] : null;
}
export function overallStatus(vehicle: Vehicle) {
  const statuses = [expiryStatus(vehicle.roadworthy_expiry_date), expiryStatus(vehicle.insurance_expiry_date)];
  return statuses.includes('Expired') ? 'Expired' : statuses.includes('Missing') ? 'Missing' : statuses.includes('Due soon') ? 'Due soon' : 'Current';
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
