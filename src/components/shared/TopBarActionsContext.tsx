import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Ctx = {
  actions: ReactNode | null;
  setActions: (node: ReactNode | null) => void;
  quickStat: { label: string; value: string } | null;
  setQuickStat: (stat: { label: string; value: string } | null) => void;
};

const TopBarCtx = createContext<Ctx | null>(null);

export function TopBarActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const [quickStat, setQuickStat] = useState<{ label: string; value: string } | null>(null);
  return (
    <TopBarCtx.Provider value={{ actions, setActions, quickStat, setQuickStat }}>
      {children}
    </TopBarCtx.Provider>
  );
}

export function useTopBarSlots() {
  const ctx = useContext(TopBarCtx);
  return ctx ?? { actions: null, setActions: () => {}, quickStat: null, setQuickStat: () => {} };
}

export function useTopBarActions(node: ReactNode) {
  const { setActions } = useTopBarSlots();
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useTopBarQuickStat(stat: { label: string; value: string } | null) {
  const { setQuickStat } = useTopBarSlots();
  useEffect(() => {
    setQuickStat(stat);
    return () => setQuickStat(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stat?.label, stat?.value]);
}
