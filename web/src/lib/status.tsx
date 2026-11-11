"use client";
import { createContext, useContext } from "react";
import { get } from "./api";
import type { Status } from "./types";
import { usePoll } from "./use-poll";

const Ctx = createContext<{ status: Status | null; error: string | null }>({ status: null, error: null });

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const { data, error } = usePoll(() => get<Status>("/api/status"), 4000);
  return <Ctx.Provider value={{ status: data, error }}>{children}</Ctx.Provider>;
}

export const useStatus = () => useContext(Ctx);
