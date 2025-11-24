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

// Declaración de trabajadores con su rol (oficina / campo)
export const WORKERS: Worker[] = [
  {
    id: 1,
    firstName: "Andrés",
    lastName: "Córdoba Hoyos",
    email: "andres2529cordoba@gmail.com",
    phone: "3182057561",
    role: "field",
  },
  {
    id: 2,
    firstName: "Brenda",
    lastName: "Parra Sanchez",
    email: "brendaparra04@hotmail.com",
    phone: "3234130761",
    role: "office",
  },
  {
    id: 3,
    firstName: "Edinson",
    lastName: "Riascos Gomez",
    email: "redinson816@gmail.com",
    phone: "3125658993",
    role: "field",
  },
  {
    id: 4,
    firstName: "Gerardo",
    lastName: "Vélez Arias",
    email: "Gerardovelez@conectate.com.co",
    phone: "3017697066",
    role: "office",
  },
  {
    id: 6,
    firstName: "Jari Alexander",
    lastName: "Otero",
    email: "alexanderotero606@gmail.com",
    phone: "(302)7170444",
    role: "field",
  },
  {
    id: 7,
    firstName: "Jorge Eliecer",
    lastName: "López Posso",
    email: "Joreli2227@gmail.com",
    phone: "3177427777",
    role: "field",
  },
  {
    id: 8,
    firstName: "Maricela",
    lastName: "Herrera Cardenas",
    email: "maricela20152@gmail.com",
    phone: "3136966516",
    role: "office",
  },
  {
    id: 9,
    firstName: "Sharon Daniela",
    lastName: "Mera Sánchez",
    email: "sharon27mera@gmail.com",
    phone: "3001315776",
    role: "field",
  },
  {
    id: 10,
    firstName: "Yolfredy",
    lastName: "Mosquera Botero",
    email: "yolfredym@gmail.com",
    phone: "3126571993",
    role: "field",
  },
];

const EVENT_DURATION_MINUTES = 45;
const WAITING_BUFFER_MINUTES = 15;
const SLOT_TOTAL_MINUTES = EVENT_DURATION_MINUTES + WAITING_BUFFER_MINUTES; // 60 minutos por ticket

const WORKING_WINDOWS = [
  { startHour: 8, endHour: 12 },
  { startHour: 14, endHour: 17 },
];

const pad = (n: number) => String(n).padStart(2, "0");

const toLocalISOString = (d: Date) => {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
};

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60000);

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
  for (;;) {
    const windows = getWindowsForDate(cursor);
    const [morning, afternoon] = windows;

    if (cursor < morning.start) return morning.start;
    if (cursor >= morning.start && cursor < morning.end) return cursor;
    if (cursor >= morning.end && cursor < afternoon.start) return afternoon.start;
    if (cursor >= afternoon.start && cursor < afternoon.end) return cursor;

    // Pasado de las 5pm -> siguiente día a las 8am
    cursor = addMinutes(sameDayWithTime(cursor, 8), 24 * 60);
  }
};

const fitsInCurrentWindow = (start: Date, end: Date) => {
  const windows = getWindowsForDate(start);
  return windows.some((w) => start >= w.start && end <= w.end);
};

const overlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

const applyMorningRule = (createdAt: Date) => {
  const sevenAM = sameDayWithTime(createdAt, 7);
  const eightAM = sameDayWithTime(createdAt, 8);
  const nineAM = sameDayWithTime(createdAt, 9);

  if (createdAt < sevenAM) return eightAM;
  if (createdAt <= eightAM) return nineAM;
  return createdAt;
};

const pickEligibleWorkers = (roleHint?: WorkerRole) => {
  if (!roleHint) return WORKERS;
  return WORKERS.filter((w) => w.role === roleHint);
};

const earliestAvailableWorker = (
  candidates: Worker[],
  availability: Map<number, Date>,
  desiredStart: Date,
): { worker: Worker; availableAt: Date } => {
  let chosen: { worker: Worker; availableAt: Date } | null = null;
  for (const worker of candidates) {
    const workerAvailable = availability.get(worker.id) ?? desiredStart;
    const ready = nextWorkingStart(workerAvailable < desiredStart ? desiredStart : workerAvailable);
    if (!chosen || ready < chosen.availableAt) {
      chosen = { worker, availableAt: ready };
    }
  }
  // siempre habrá al menos un candidato
  return chosen!;
};

export const inferRoleFromName = (name?: string): WorkerRole | undefined => {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();
  if (["brenda", "gerardo", "maricela"].some((w) => normalized.includes(w))) return "office";
  return "field";
};

export function scheduleTickets(tickets: TicketToSchedule[]): ScheduledTicket[] {
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
      const candidates = pickEligibleWorkers(ticket.roleHint);
      const { worker, availableAt } = earliestAvailableWorker(
        candidates,
        availability,
        desiredStart,
      );

      const start = availableAt;
      const end = addMinutes(start, SLOT_TOTAL_MINUTES);

      // Validar que el bloque completo cabe en la franja laboral
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
          .reduce((min, current) => Math.min(min, current), Number.POSITIVE_INFINITY);
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
