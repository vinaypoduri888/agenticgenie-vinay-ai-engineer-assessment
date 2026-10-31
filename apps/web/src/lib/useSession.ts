"use client";

import { useEffect, useState } from "react";
import { clearSession, getStoredUser, getToken, type StoredUser } from "./api";

/** Client-side session check, used at the top of every page that needs
 * auth. Returns `undefined` while still checking (avoids a flash of
 * "redirecting" before localStorage has been read), `null` once confirmed
 * logged out. */
export function useSession() {
  const [user, setUser] = useState<StoredUser | null | undefined>(undefined);

  useEffect(() => {
    const token = getToken();
    const storedUser = getStoredUser();
    setUser(token && storedUser ? storedUser : null);
  }, []);

  function logout() {
    clearSession();
    setUser(null);
    window.location.href = "/login";
  }

  return { user, logout };
}
