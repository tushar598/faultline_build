import type { EventStatus } from "@/lib/abi";
import type { Tone } from "../ui/Tag";

export const STATUS_TONE: Record<EventStatus, Tone> = { None: "neutral", Pending: "error", Vetoed: "neutral", Executed: "accent", Superseded: "info" };
