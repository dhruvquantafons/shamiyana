import type { ShiftColor } from "../../../lib/types";

export const SHIFT_COLOR_CLASS: Record<ShiftColor, string> = {
  slate: "bg-slate-100 text-slate-800",
  yellow: "bg-yellow-100 text-yellow-900",
  orange: "bg-orange-100 text-orange-900",
  indigo: "bg-indigo-100 text-indigo-900",
  emerald: "bg-emerald-100 text-emerald-900",
  rose: "bg-rose-100 text-rose-900",
  sky: "bg-sky-100 text-sky-900",
  violet: "bg-violet-100 text-violet-900",
};

export type HrStaff = {
  id: string;
  full_name: string;
  email: string;
  job_title: string;
  role: string;
  employee_code: string | null;
  department_id: string | null;
  default_shift_id: string | null;
  weekly_off: number | null;
};

export const HR_STAFF_COLUMNS = "id, full_name, email, job_title, role, employee_code, department_id, default_shift_id, weekly_off";
