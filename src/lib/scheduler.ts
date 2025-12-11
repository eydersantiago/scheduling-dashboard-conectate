// src/lib/scheduler.ts

export type WorkerRole = "office" | "field";

export interface Worker {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: WorkerRole;
  color_hex?: string;
}

export interface TicketToSchedule {
  id: string;
  title: string;
  createdAt: string; // ISO string
  roleHint?: WorkerRole;
  ticket_external_id?: string | number;
  estado?: string;
  color?: string;
}

export interface ScheduledTicket extends TicketToSchedule {
  start: string; // ISO local string
  end: string;   // ISO local string
  worker: Worker;
}

// --- Parámetros de agenda ---
// 45 minutos de atención + 15 minutos de espera
const EVENT_DURATION_MINUTES = 45;
const WAITING_BUFFER_MINUTES = 15;
const SLOT_TOTAL_MINUTES = EVENT_DURATION_MINUTES + WAITING_BUFFER_MINUTES; // 60 minutos

// Franja laboral: 8-12 y 14-17 (no se agenda 12-14)
const WORKING_WINDOWS = [
  { startHour: 8, endHour: 12 },
  { startHour: 14, endHour: 17 },
];

// Helpers de fechas
const pad = (n: number) => String(n).padStart(2, "0");

const toLocalISOString = (d: Date) => {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
};

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60000);

const sameDayWithTime = (date: Date, hour: number, minute = 0) => {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const getWindowsForDate = (date: Date) => {
  return WORKING_WINDOWS.map(({ startHour, endHour }) => ({
    start: sameDayWithTime(date, startHour),
    end: sameDayWithTime(date, endHour),
  }));
};

const nextWorkingStart = (date: Date): Date => {
  let cursor = new Date(date);
  // Avanza hasta caer dentro de alguna franja laboral
  for (;;) {
    const [morning, afternoon] = getWindowsForDate(cursor);

    if (cursor < morning.start) return morning.start;
    if (cursor >= morning.start && cursor < morning.end) return cursor;
    if (cursor >= morning.end && cursor < afternoon.start) return afternoon.start;
    if (cursor >= afternoon.start && cursor < afternoon.end) return cursor;

    // Si ya pasó de las 17:00 → siguiente día 8:00
    cursor = addMinutes(sameDayWithTime(cursor, 8), 24 * 60);
  }
};

const fitsInCurrentWindow = (start: Date, end: Date) => {
  const windows = getWindowsForDate(start);
  return windows.some((w) => start >= w.start && end <= w.end);
};

const overlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

/**
 * Regla especial de la mañana:
 * - Tickets generados hasta las 07:00 → se programan a las 08:00.
 * - Tickets generados entre 07:01 y 08:00 → se programan a las 09:00.
 * - Después de las 08:00 → usan su hora real (ajustada a franja laboral).
 */
const applyMorningRule = (createdAt: Date) => {
  const sevenAM = sameDayWithTime(createdAt, 7, 0);
  const eightAM = sameDayWithTime(createdAt, 8, 0);
  const nineAM = sameDayWithTime(createdAt, 9, 0);

  if (createdAt <= sevenAM) return eightAM;
  if (createdAt <= eightAM) return nineAM;
  return createdAt;
};

// --- Selección de trabajadores ---

const pickEligibleWorkers = (roleHint: WorkerRole | undefined, pool: Worker[]) => {
  if (!roleHint) return pool;
  return pool.filter((w) => w.role === roleHint);
};

const earliestAvailableWorker = (
  candidates: Worker[],
  availability: Map<number, Date>,
  desiredStart: Date,
): { worker: Worker; availableAt: Date } => {
  let chosen: { worker: Worker; availableAt: Date } | null = null;

  for (const worker of candidates) {
    const workerAvailable = availability.get(worker.id) ?? desiredStart;
    const ready = nextWorkingStart(
      workerAvailable < desiredStart ? desiredStart : workerAvailable,
    );
    if (!chosen || ready < chosen.availableAt) {
      chosen = { worker, availableAt: ready };
    }
  }

  // asumimos que siempre hay al menos 1 candidato
  return chosen!;
};

// --- Inferencia de rol a partir del nombre ---
// Oficina: Brenda, Gerardo, Maricela
export const inferRoleFromName = (name?: string): WorkerRole | undefined => {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();

  if (["brenda", "gerardo", "maricela"].some((w) => normalized.includes(w))) {
    return "office";
  }
  return "field";
};

/**
 * Agenda tickets respetando:
 * - Horario 8-12 y 14-17 (no 12-14).
 * - Máximo 3 tickets en paralelo.
 * - Duración 45 min + 15 min de espera (1h por ticket).
 * - Regla de la mañana (antes de 7 → 8am; 7:01-8 → 9am).
 *
 * Requiere que `workers` venga desde la BD.
 * Si `workers` está vacío, devuelve [] y NO agenda nada.
 */
export function scheduleTickets(
  tickets: TicketToSchedule[],
  workers: Worker[],
): ScheduledTicket[] {
  if (!workers || workers.length === 0) {
    console.error(
      "[scheduleTickets] No se recibió lista de trabajadores desde la BD. " +
        "No se aplicará agendamiento automático.",
    );
    return [];
  }

  // Ordenar por fecha de creación
  const sorted = [...tickets].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const availability = new Map<number, Date>();
  const scheduled: ScheduledTicket[] = [];

  for (const ticket of sorted) {
    let desiredStart = nextWorkingStart(applyMorningRule(new Date(ticket.createdAt)));
    let attempts = 0;

    while (attempts < 2000) {
      attempts += 1;

      const candidates = pickEligibleWorkers(ticket.roleHint, workers);
      const { worker, availableAt } = earliestAvailableWorker(
        candidates,
        availability,
        desiredStart,
      );

      const start = availableAt;
      const end = addMinutes(start, SLOT_TOTAL_MINUTES);

      // Validar que el bloque completo cabe en una franja laboral
      if (!fitsInCurrentWindow(start, end)) {
        desiredStart = nextWorkingStart(addMinutes(start, SLOT_TOTAL_MINUTES));
        continue;
      }

      // Respetar máximo de 3 tickets simultáneos
      const overlapping = scheduled.filter((ev) =>
        overlap(start, end, new Date(ev.start), new Date(ev.end)),
      );

      if (overlapping.length >= 3) {
        const earliestEnd = overlapping
          .map((ev) => new Date(ev.end).getTime())
          .reduce(
            (min, current) => Math.min(min, current),
            Number.POSITIVE_INFINITY,
          );
        desiredStart = nextWorkingStart(new Date(earliestEnd));
        continue;
      }

      const scheduledTicket: ScheduledTicket = {
        ...ticket,
        start: toLocalISOString(start),
        end: toLocalISOString(end),
        worker,
      };

      scheduled.push(scheduledTicket);
      availability.set(worker.id, end);
      break;
    }
  }

  return scheduled;
}