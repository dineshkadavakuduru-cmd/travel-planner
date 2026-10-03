export interface Spot {
  name: string;
  description: string;
  estTimeMinutes: number;
  placeId?: string;
  lat?: number;
  lng?: number;
}

export interface FoodPick {
  name: string;
  cuisine: string;
  priceTier: "budget" | "mid" | "splurge";
  placeId?: string;
  lat?: number;
  lng?: number;
}

export interface DayPlan {
  dayNumber: number;
  theme: string;
  spots: Spot[];
  food: FoodPick[];
}

export interface Trip {
  id: string;
  ownerId?: string;
  destination: string;
  originAirportOrCity: string;
  budget: number;
  currency: string;
  createdAt: Date | string;
  updatedAt?: Date | string;
  days: DayPlan[];
  totalEstCost: number;
  isPublic: boolean;
  enriched?: boolean;
}

/** Shape of the raw Firestore document (Timestamp fields not yet serialized). */
export interface TripDocument {
  id: string;
  createdAt?: { toDate?: () => Date; seconds?: number } | string | Date | unknown;
  [key: string]: unknown;
}

export function toTrip(doc: TripDocument, data: Record<string, unknown>): Trip {
  const raw = data.createdAt as TripDocument["createdAt"];
  let createdAt: Date | string = new Date().toISOString();
  if (typeof raw === "string") createdAt = raw;
  else if (raw instanceof Date) createdAt = raw.toISOString();
  else if (raw && typeof raw === "object") {
    if (typeof (raw as { toDate?: unknown }).toDate === "function") {
      createdAt = (raw as { toDate: () => Date }).toDate().toISOString();
    } else if (typeof (raw as { seconds?: unknown }).seconds === "number") {
      createdAt = new Date((raw as { seconds: number }).seconds * 1000).toISOString();
    }
  }
  return { ...(data as unknown as Omit<Trip, "id" | "createdAt">), id: doc.id, createdAt };
}

export interface ItineraryResponse {
  days: DayPlan[];
  totalEstCost: number;
}

export interface GenerateItineraryRequest {
  destination: string;
  origin: string;
  budget: number;
  days: number;
}

export interface GenerateItineraryResponse {
  days: DayPlan[];
  totalEstCost: number;
}
