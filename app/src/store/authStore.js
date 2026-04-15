import { create } from "zustand";

const useAuthStore = create((set) => ({
  authToken: localStorage.getItem("wavecraft_token") || null,
  authUser: (() => {
    try { return JSON.parse(localStorage.getItem("wavecraft_user") || "null"); } catch { return null; }
  })(),
  authModal: null, // null | "login" | "signup"
  authForm: { email: "", password: "", displayName: "" },
  authError: "",
  authLoading: false,

  setAuthToken: (v) => set({ authToken: v }),
  setAuthUser: (v) => set({ authUser: v }),
  setAuthModal: (v) => set({ authModal: v }),
  setAuthForm: (v) => set((s) => ({ authForm: typeof v === "function" ? v(s.authForm) : v })),
  setAuthError: (v) => set({ authError: v }),
  setAuthLoading: (v) => set({ authLoading: v }),

  login: (token, user) => {
    localStorage.setItem("wavecraft_token", token);
    localStorage.setItem("wavecraft_user", JSON.stringify(user));
    set({ authToken: token, authUser: user, authModal: null, authForm: { email: "", password: "", displayName: "" } });
  },

  logout: () => {
    localStorage.removeItem("wavecraft_token");
    localStorage.removeItem("wavecraft_user");
    set({ authToken: null, authUser: null });
  },
}));

export default useAuthStore;
